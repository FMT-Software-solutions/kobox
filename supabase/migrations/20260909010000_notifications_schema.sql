-- Notifications: the outbox, the devices, the preferences and the SMS budget.
--
-- ONE outbox, two channels. Triggers and RPCs write rows here inside the same
-- transaction as the thing that happened; a worker drains them afterwards.
-- Sending inline would be the bug that matters: a payment trigger that texts
-- "₵100 recorded for you" and then rolls back has told somebody their money is
-- safe when no such row exists.
--
-- Categories and statuses are `text` with CHECK constraints rather than enums,
-- deliberately. Postgres refuses to use a new enum value in the transaction
-- that adds it, so every future category would need its own migration ahead of
-- the code that uses it. A CHECK is edited in place.

-- ---------------------------------------------------------------------------
-- Who a group texts on, and what it may spend
--
-- `organizationId` / `appId` are what fmt-ss-backend runs its credit pre-flight
-- against — the OTP path omits them precisely so no group is billed for a
-- login. Group notifications must carry them, so the group's own credits pay.
--
-- Both NULL means SMS is OFF for that group. That is the safe default and the
-- honest one: until somebody supplies the mapping, no group can be billed by
-- accident and everyone still gets push.
-- ---------------------------------------------------------------------------

alter table groups
  add column if not exists sms_organization_id text,
  add column if not exists sms_app_id          text,
  -- A hard ceiling the owner sets. Push keeps working after it is reached.
  add column if not exists sms_monthly_cap     int not null default 200;

comment on column groups.sms_organization_id is
  'fmt-ss-backend organization. NULL disables SMS for this group entirely.';

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

create table if not exists expo_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Expo's token identifies a device+app install, and is the natural key: the
  -- same device reinstalled gets a new one, and the same token can move between
  -- accounts on a shared phone, which is why it is unique on its own.
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android', 'web')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists expo_push_tokens_user_idx on expo_push_tokens (user_id);

alter table expo_push_tokens enable row level security;

create policy expo_push_tokens_own on expo_push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Preferences
--
-- Per MEMBER, not per user: somebody may want every reminder from the group
-- collecting their rent and none from the old students' association.
-- ---------------------------------------------------------------------------

create table if not exists notification_preferences (
  member_id uuid primary key references group_members (id) on delete cascade,
  push_enabled boolean not null default true,
  sms_enabled  boolean not null default true,
  -- Reminders are the noisy category and the one people want to silence.
  -- Receipts are not opt-out: a receipt is a record of money, and somebody
  -- who has switched them off cannot later say they were never told.
  reminders_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table notification_preferences enable row level security;

create policy notification_preferences_own on notification_preferences
  for all using (
    exists (select 1 from group_members m where m.id = member_id and m.user_id = auth.uid())
  )
  with check (
    exists (select 1 from group_members m where m.id = member_id and m.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id) on delete cascade,
  -- The member this is ABOUT and addressed to. Null for a notification aimed at
  -- a role rather than a person (see `audience`).
  member_id  uuid references group_members (id) on delete cascade,
  -- Denormalised so the dispatcher never has to join back to a row that may
  -- have been deleted by the time it runs.
  user_id    uuid references auth.users (id) on delete cascade,
  phone_e164 text,

  category text not null check (category in (
    'join_request', 'join_decision', 'payment_recorded', 'payment_reversed',
    'payment_pending', 'expense_pending', 'period_opened', 'overdue',
    'susu_payout', 'invite_expiring', 'digest'
  )),

  title    text not null,
  body     text not null,
  /** Written separately: an SMS pays per character and cannot use a title. */
  sms_body text,

  want_push boolean not null default true,
  want_sms  boolean not null default false,

  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),

  /**
   * One event, one row, for ever. A retry, a double-fired trigger or a cron run
   * that overlaps itself all collide here instead of texting somebody twice —
   * and a duplicate SMS costs money as well as trust.
   */
  dedupe_key text not null unique,

  -- Lets quiet hours defer a message rather than drop it.
  send_after timestamptz not null default now(),

  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  push_sent  boolean not null default false,
  sms_sent   boolean not null default false
);

create index if not exists notifications_due_idx
  on notifications (status, send_after)
  where status = 'pending';

create index if not exists notifications_group_month_idx
  on notifications (group_id, sent_at)
  where sms_sent = true;

alter table notifications enable row level security;

-- Readable only by the person it is addressed to. The dispatcher runs as the
-- function owner and bypasses this.
create policy notifications_own on notifications
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- SMS budget
-- ---------------------------------------------------------------------------

/**
 * How many SMS this group has sent in the current calendar month.
 *
 * Counted from the outbox rather than kept as a counter: a counter and the rows
 * it counts are two copies of one fact, and this project has already paid for
 * that mistake three times.
 */
create function group_sms_used_this_month(p_group_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from notifications
  where group_id = p_group_id
    and sms_sent = true
    and sent_at >= date_trunc('month', now());
$$;

/** True when this group may still send an SMS right now. */
create function group_can_send_sms(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from groups g
    where g.id = p_group_id
      -- No organization means no way to bill it, so no SMS. Push still works.
      and g.sms_organization_id is not null
      and group_sms_used_this_month(g.id) < g.sms_monthly_cap
  );
$$;

grant execute on function group_sms_used_this_month(uuid) to authenticated;
grant execute on function group_can_send_sms(uuid) to authenticated;
