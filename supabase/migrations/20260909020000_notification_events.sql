-- What gets queued, and when.
--
-- Every trigger here writes an outbox row and nothing else. No HTTP, no
-- sending, no waiting: a trigger that reached out to a network would hold a
-- money transaction open on somebody else's uptime.

/**
 * The one way a notification is created.
 *
 * Resolves the recipient's account and phone at enqueue time and stores them on
 * the row, so the dispatcher never depends on a member record that may have
 * changed — or been deleted — by the time it runs.
 *
 * Silently does nothing when there is nobody to tell. A member with no Kobox
 * account and no phone is not an error; it is most of a real group.
 */
create function enqueue_notification(
  p_group_id   uuid,
  p_member_id  uuid,
  p_category   text,
  p_title      text,
  p_body       text,
  p_sms_body   text default null,
  p_dedupe_key text default null,
  p_send_after timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
  v_prefs  notification_preferences;
  v_key    text;
  v_push   boolean;
  v_sms    boolean;
begin
  select * into v_member from group_members where id = p_member_id;
  if v_member.id is null or v_member.status = 'left' then
    return;
  end if;

  select * into v_prefs from notification_preferences where member_id = p_member_id;

  -- Absent preferences mean the defaults, not "off".
  v_push := coalesce(v_prefs.push_enabled, true);
  v_sms  := coalesce(v_prefs.sms_enabled, true);

  -- Reminders are the one category somebody may silence. Receipts are a record
  -- of money and stay on.
  if p_category in ('period_opened', 'overdue')
     and not coalesce(v_prefs.reminders_enabled, true) then
    return;
  end if;

  -- An SMS is only worth queueing for the categories that justify the cost, and
  -- only when the group can actually pay for it. `group_can_send_sms` is
  -- checked again at dispatch, because a month's budget can run out between
  -- queueing and sending.
  v_sms := v_sms
    and v_member.phone_e164 is not null
    and p_category in (
      'payment_recorded', 'payment_reversed', 'period_opened', 'overdue', 'susu_payout'
    )
    and group_can_send_sms(p_group_id);

  if not v_push and not v_sms then
    return;
  end if;

  -- Default key covers the common case: one notification per member per event.
  v_key := coalesce(p_dedupe_key, p_category || ':' || p_member_id::text || ':' || now()::text);

  insert into notifications (
    group_id, member_id, user_id, phone_e164,
    category, title, body, sms_body,
    want_push, want_sms, dedupe_key, send_after
  )
  values (
    p_group_id, p_member_id, v_member.user_id, v_member.phone_e164,
    p_category, p_title, p_body, coalesce(p_sms_body, p_body),
    v_push and v_member.user_id is not null, v_sms,
    v_key, p_send_after
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke execute on function enqueue_notification(uuid, uuid, text, text, text, text, text, timestamptz)
  from anon, authenticated;

/** Everyone in a group holding at least `p_min_role`. */
create function enqueue_for_role(
  p_group_id   uuid,
  p_min_role   member_role,
  p_category   text,
  p_title      text,
  p_body       text,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_member record;
begin
  for r_member in
    select id from group_members
    where group_id = p_group_id
      and status = 'active'
      and role_rank(role) >= role_rank(p_min_role)
  loop
    perform enqueue_notification(
      p_group_id, r_member.id, p_category, p_title, p_body, null,
      -- The key must include the recipient, or only the first admin is told.
      p_dedupe_key || ':' || r_member.id::text
    );
  end loop;
end;
$$;

revoke execute on function enqueue_for_role(uuid, member_role, text, text, text, text)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Somebody wants to join
-- ---------------------------------------------------------------------------

create function notify_join_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select * into v_group from groups where id = new.group_id;

  perform enqueue_for_role(
    new.group_id, 'admin', 'join_request',
    'Someone wants to join',
    new.full_name || ' asked to join ' || v_group.name || '. Approve or decline them in Members.',
    'join_request:' || new.id::text
  );

  return new;
end;
$$;

create trigger group_members_notify_join_request
  after insert on group_members
  for each row execute function notify_join_request();

-- ---------------------------------------------------------------------------
-- They were let in
-- ---------------------------------------------------------------------------

create function notify_join_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  if old.status = 'pending' and new.status = 'active' then
    select * into v_group from groups where id = new.group_id;

    perform enqueue_notification(
      new.group_id, new.id, 'join_decision',
      'You are in',
      'You have been approved to join ' || v_group.name || '.',
      null,
      'join_decision:' || new.id::text
    );
  end if;

  return new;
end;
$$;

create trigger group_members_notify_join_decision
  after update on group_members
  for each row execute function notify_join_decision();

-- ---------------------------------------------------------------------------
-- Money in
--
-- The receipt. This is the notification that makes a ledger nobody can see
-- worth trusting: somebody hands over cash and their phone says so.
-- ---------------------------------------------------------------------------

create function notify_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group  groups;
  v_amount text;
begin
  select * into v_group from groups where id = new.group_id;
  v_amount := v_group.currency || ' ' || to_char(abs(new.amount) / 100.0, 'FM999999990.00');

  -- A reversal is a negative row, and the member should hear about it: money
  -- they were told was recorded no longer is.
  if new.amount < 0 then
    perform enqueue_notification(
      new.group_id, new.member_id, 'payment_reversed',
      'A payment was reversed',
      v_amount || ' recorded earlier has been reversed by ' || v_group.name || '.',
      v_amount || ' recorded for you in ' || v_group.name || ' has been reversed. Ask your treasurer if this is unexpected.',
      'payment_reversed:' || new.id::text
    );
    return new;
  end if;

  if new.status = 'confirmed' then
    perform enqueue_notification(
      new.group_id, new.member_id, 'payment_recorded',
      'Payment recorded',
      v_amount || ' has been recorded for you in ' || v_group.name || '.',
      v_amount || ' received. Thank you. ' || v_group.name,
      'payment_recorded:' || new.id::text
    );
  else
    -- A member filed it themselves; a treasurer has to agree it happened.
    perform enqueue_for_role(
      new.group_id, 'treasurer', 'payment_pending',
      'A payment needs confirming',
      v_amount || ' was recorded and is waiting for you to confirm it.',
      'payment_pending:' || new.id::text
    );
  end if;

  return new;
end;
$$;

create trigger payments_notify
  after insert on payments
  for each row execute function notify_payment();

/** A pending payment becoming confirmed is the receipt moment for that member. */
create function notify_payment_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group  groups;
  v_amount text;
begin
  if old.status = 'pending' and new.status = 'confirmed' and new.amount > 0 then
    select * into v_group from groups where id = new.group_id;
    v_amount := v_group.currency || ' ' || to_char(new.amount / 100.0, 'FM999999990.00');

    perform enqueue_notification(
      new.group_id, new.member_id, 'payment_recorded',
      'Payment confirmed',
      v_amount || ' has been confirmed in ' || v_group.name || '.',
      v_amount || ' confirmed. Thank you. ' || v_group.name,
      'payment_confirmed:' || new.id::text
    );
  end if;

  return new;
end;
$$;

create trigger payments_notify_confirmed
  after update on payments
  for each row execute function notify_payment_confirmed();

-- ---------------------------------------------------------------------------
-- Money out
-- ---------------------------------------------------------------------------

create function notify_expense_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group  groups;
  v_amount text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select * into v_group from groups where id = new.group_id;
  v_amount := v_group.currency || ' ' || to_char(new.amount / 100.0, 'FM999999990.00');

  perform enqueue_for_role(
    new.group_id, 'admin', 'expense_pending',
    'An expense needs approval',
    new.title || ' — ' || v_amount || ' is waiting to be approved.',
    'expense_pending:' || new.id::text
  );

  return new;
end;
$$;

create trigger expenses_notify_pending
  after insert on expenses
  for each row execute function notify_expense_pending();

-- ---------------------------------------------------------------------------
-- Susu: your turn to collect
-- ---------------------------------------------------------------------------

create function notify_susu_payout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan  plans;
  v_group groups;
  v_amount text;
begin
  if new.paid_out_at is null or old.paid_out_at is not null then
    return new;
  end if;

  select * into v_plan from plans where id = new.plan_id;
  select * into v_group from groups where id = v_plan.group_id;
  v_amount := v_group.currency || ' ' ||
              to_char(coalesce(new.paid_out_amount, 0) / 100.0, 'FM999999990.00');

  perform enqueue_notification(
    v_plan.group_id, new.member_id, 'susu_payout',
    'Your susu payout',
    v_amount || ' has been paid out to you from ' || v_plan.name || '.',
    v_amount || ' paid out to you from ' || v_plan.name || '. ' || v_group.name,
    'susu_payout:' || new.id::text
  );

  return new;
end;
$$;

create trigger rotation_slots_notify_payout
  after update on rotation_slots
  for each row execute function notify_susu_payout();
