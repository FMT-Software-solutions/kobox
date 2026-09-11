-- Reminders, and the clock that drives everything.
--
-- Two separate jobs, because they fail differently: QUEUEING is pure SQL and
-- cannot cost money, while DISPATCHING makes network calls and can. Keeping
-- them apart means a broken dispatcher backs messages up rather than losing
-- them, and a broken queue never silently drains credit.

-- ---------------------------------------------------------------------------
-- Where the dispatcher lives
--
-- A one-row table rather than a secret baked into a migration. Migrations are
-- committed to the repo; a service key or a shared secret in one is a secret in
-- everybody's git history for ever.
--
-- Until this is filled in, the cron job below does nothing at all. That is the
-- intended resting state of a fresh project.
-- ---------------------------------------------------------------------------

create table if not exists app_config (
  id              boolean primary key default true check (id),
  dispatch_url    text,
  dispatch_secret text,
  updated_at      timestamptz not null default now()
);

insert into app_config (id) values (true) on conflict (id) do nothing;

alter table app_config enable row level security;
-- No policy at all: deny-by-default. Only SECURITY DEFINER functions read it.

-- ---------------------------------------------------------------------------
-- Quiet hours
-- ---------------------------------------------------------------------------

/**
 * Nothing texts anybody in the middle of the night.
 *
 * Returns when a message queued now should actually go out. Ghana is UTC+0 all
 * year, so this needs no daylight-saving handling — but it is written against
 * the group's timezone anyway, because the column already exists and assuming
 * otherwise is how an app becomes un-exportable.
 */
create function next_sendable_at(p_group_id uuid, p_now timestamptz default now())
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz    text;
  v_local timestamp;
  v_hour  int;
begin
  select coalesce(timezone, 'Africa/Accra') into v_tz from groups where id = p_group_id;

  v_local := p_now at time zone v_tz;
  v_hour  := extract(hour from v_local);

  if v_hour >= 21 then
    -- Tomorrow morning.
    return ((date_trunc('day', v_local) + interval '1 day 7 hours') at time zone v_tz);
  elsif v_hour < 7 then
    return ((date_trunc('day', v_local) + interval '7 hours') at time zone v_tz);
  end if;

  return p_now;
end;
$$;

-- ---------------------------------------------------------------------------
-- "A new period is open and you owe"
--
-- ONE message per member, not one per contribution. Somebody behind on dues,
-- a levy and a welfare fund gets a single line with the total — three texts for
-- one debt is three times the cost and reads like the app is broken.
-- ---------------------------------------------------------------------------

create function queue_period_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r_row  record;
  v_count int := 0;
begin
  for r_row in
    select
      m.group_id,
      m.id                       as member_id,
      g.name                     as group_name,
      g.currency,
      sum(b.amount_due - b.amount_paid) as owing
    from group_members m
    join groups g on g.id = m.group_id
    join obligation_balances b on b.member_id = m.id
    join cycles c on c.id = b.cycle_id
    join plans p on p.id = c.plan_id and p.group_id = m.group_id and p.status = 'active'
    where m.status = 'active'
      and c.status = 'open'
      and b.amount_due > b.amount_paid
    group by m.group_id, m.id, g.name, g.currency
    having sum(b.amount_due - b.amount_paid) > 0
  loop
    perform enqueue_notification(
      r_row.group_id,
      r_row.member_id,
      'period_opened',
      'You have a contribution due',
      'You owe ' || r_row.currency || ' ' ||
        to_char(r_row.owing / 100.0, 'FM999999990.00') || ' in ' || r_row.group_name || '.',
      'Reminder: you owe ' || r_row.currency || ' ' ||
        to_char(r_row.owing / 100.0, 'FM999999990.00') || ' in ' || r_row.group_name || '.',
      -- Once per member per month, whatever else changes.
      'period_opened:' || r_row.member_id::text || ':' || to_char(now(), 'YYYY-MM'),
      next_sendable_at(r_row.group_id)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- "You are past the due date"
--
-- Separate from the above because it is a different message with a different
-- tone, and because the grace period is the group's own setting.
-- ---------------------------------------------------------------------------

create function queue_overdue_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r_row   record;
  v_count int := 0;
begin
  for r_row in
    select
      m.group_id,
      m.id   as member_id,
      g.name as group_name,
      g.currency,
      sum(b.amount_due - b.amount_paid) as owing,
      count(*) as periods
    from group_members m
    join groups g on g.id = m.group_id
    join obligation_balances b on b.member_id = m.id
    join cycles c on c.id = b.cycle_id
    join plans p on p.id = c.plan_id and p.group_id = m.group_id and p.status = 'active'
    where m.status = 'active'
      and b.amount_due > b.amount_paid
      -- Past the due date AND past the grace the group allows.
      and c.due_date + (p.grace_days || ' days')::interval < now()
    group by m.group_id, m.id, g.name, g.currency
    having sum(b.amount_due - b.amount_paid) > 0
  loop
    perform enqueue_notification(
      r_row.group_id,
      r_row.member_id,
      'overdue',
      'Overdue contribution',
      'You are behind on ' || r_row.periods || ' ' ||
        case when r_row.periods = 1 then 'period' else 'periods' end ||
        ' — ' || r_row.currency || ' ' ||
        to_char(r_row.owing / 100.0, 'FM999999990.00') || ' in ' || r_row.group_name || '.',
      r_row.group_name || ': you are behind ' || r_row.currency || ' ' ||
        to_char(r_row.owing / 100.0, 'FM999999990.00') || '. Please pay when you can.',
      -- Weekly at most. Nagging daily is how a group gets its sender blocked.
      'overdue:' || r_row.member_id::text || ':' || to_char(now(), 'IYYY-IW'),
      next_sendable_at(r_row.group_id)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/** An invite code about to lapse, so an admin can mint a new one in time. */
create function queue_invite_expiry_warnings()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r_group record;
  v_count int := 0;
begin
  for r_group in
    select id, name, join_code_expires_at
    from groups
    where join_code_expires_at is not null
      and join_code_expires_at between now() and now() + interval '3 days'
  loop
    perform enqueue_for_role(
      r_group.id, 'admin', 'invite_expiring',
      'Invite code expiring',
      'The invite code for ' || r_group.name || ' stops working on ' ||
        to_char(r_group.join_code_expires_at, 'FMDD Mon') || '. Generate a new one when you need it.',
      'invite_expiring:' || r_group.id::text || ':' ||
        to_char(r_group.join_code_expires_at, 'YYYY-MM-DD')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function queue_period_reminders() from anon, authenticated;
revoke execute on function queue_overdue_reminders() from anon, authenticated;
revoke execute on function queue_invite_expiry_warnings() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The dispatcher call
-- ---------------------------------------------------------------------------

/**
 * Pokes the Edge Function that drains the outbox.
 *
 * Does nothing when `app_config` has not been filled in, which is deliberate:
 * a fresh project should queue notifications and send none until somebody
 * consciously points it at a dispatcher.
 */
create function dispatch_notifications()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_config app_config;
begin
  select * into v_config from app_config where id;

  if v_config.dispatch_url is null or v_config.dispatch_secret is null then
    return;
  end if;

  -- Nothing waiting, nothing to wake.
  if not exists (
    select 1 from notifications where status = 'pending' and send_after <= now()
  ) then
    return;
  end if;

  perform net.http_post(
    url     := v_config.dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-secret', v_config.dispatch_secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke execute on function dispatch_notifications() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The clock
--
-- Queueing runs on a human schedule; dispatch runs often, because a receipt
-- that arrives ten minutes after the cash changed hands has missed its moment.
-- ---------------------------------------------------------------------------

select cron.schedule(
  'kobox-dispatch-notifications',
  '* * * * *',
  $cron$ select dispatch_notifications(); $cron$
);

-- 08:00 every day. Anything queued outside the sending window is held by
-- `next_sendable_at` rather than dropped.
select cron.schedule(
  'kobox-period-reminders',
  '0 8 * * *',
  $cron$ select queue_period_reminders(); $cron$
);

-- Mondays. Weekly is as often as a debt is worth mentioning.
select cron.schedule(
  'kobox-overdue-reminders',
  '0 9 * * 1',
  $cron$ select queue_overdue_reminders(); $cron$
);

select cron.schedule(
  'kobox-invite-expiry',
  '0 10 * * *',
  $cron$ select queue_invite_expiry_warnings(); $cron$
);
