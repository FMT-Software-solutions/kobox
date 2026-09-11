-- SMS credits, sender IDs, and the platform contract with fmt-ss-backend.
--
-- This is the migration that answers the question notifications were blocked
-- on: **what is an "organization" to Kobox?**
--
-- A GROUP IS THE ORGANIZATION. `organizationId` on every call to
-- fmt-ss-backend — the credit pre-flight on `/sms/send`, the Paystack purchase,
-- the webhook that credits it — is a `groups.id`. Nothing has to be
-- provisioned, nobody has to hand an id out, and a group can only ever spend
-- credit it bought itself.
--
-- The alternative, a separate organization record per group, was rejected: it
-- is a second copy of "who this group is", and this project has already paid
-- three times over for keeping one fact in two places.
--
-- The backend is app-agnostic. It resolves `appId` to a Supabase project
-- (`apps.service.ts`) and then reads and writes exactly four things in it —
-- `organization_sms_balances`, `sms_credit_transactions`, `payment_records`,
-- and the RPCs below. Those names are the contract; they are not ours to
-- rename. Everything else here is Kobox's own.
--
-- Ported from print-calc-pro's `20260723000000_create_communication_sms.sql`,
-- re-keyed from `organizations(id)` onto `groups(id)`.

-- ---------------------------------------------------------------------------
-- The sender ID a group's messages come from
--
-- Arkesel sender IDs are pre-registered with the networks and capped at 11
-- characters. NULL means "use the platform default", which is what almost every
-- group will do: `Kobox` is already registered and needs no approval, so a new
-- group can send from the moment it has credit.
-- ---------------------------------------------------------------------------

alter table groups
  add column if not exists sms_sender_id varchar(11);

comment on column groups.sms_sender_id is
  'Approved Arkesel sender ID. NULL means send as the platform default, Kobox.';

-- ---------------------------------------------------------------------------
-- Retiring the old mapping columns
--
-- `sms_organization_id` existed only to hold an id somebody else was going to
-- issue. Now that a group is its own organization the column can only ever
-- repeat `groups.id`, and a column that can only hold a copy of the primary key
-- is a column that will one day hold a stale copy of it.
--
-- What it was really doing was gating SMS off by default. That gate does not
-- disappear, it moves somewhere honest: a group sends SMS when it has credit.
-- Zero credit is the new "off", and it is enforced by the thing that actually
-- costs money rather than by an id nobody had filled in.
-- ---------------------------------------------------------------------------

alter table groups
  drop column if exists sms_organization_id,
  drop column if exists sms_app_id;

-- A deliberate off switch, separate from "has no credit". An owner who wants
-- push only can say so without emptying the wallet to prove it.
alter table groups
  add column if not exists sms_enabled boolean not null default true;

comment on column groups.sms_monthly_cap is
  'Hard ceiling on SMS CREDITS this group may spend per calendar month. '
  'Push keeps working after it is reached.';

-- ---------------------------------------------------------------------------
-- The balance
--
-- One row per group, created with the group. `bonus_credits_received` records
-- what the platform absorbed when a send cost more than the balance covered —
-- see `deduct_sms_credits`.
-- ---------------------------------------------------------------------------

create table if not exists organization_sms_balances (
  -- Named `organization_id`, holding a `groups.id`. The name is the backend's;
  -- the value is ours.
  organization_id        uuid primary key references groups (id) on delete cascade,
  credit_balance         integer not null default 0 check (credit_balance >= 0),
  bonus_credits_received integer not null default 0,
  updated_at             timestamptz not null default now()
);

alter table organization_sms_balances enable row level security;

-- Everybody in the group may see what it has left; a member who is about to be
-- told "no reminder was sent" deserves to see why.
create policy organization_sms_balances_read on organization_sms_balances
  for select using (is_group_member(organization_id));

-- No write policy at all. Balances move only through the RPCs below, called by
-- fmt-ss-backend with the service role.

-- ---------------------------------------------------------------------------
-- The ledger
--
-- Append-only in spirit and in practice: nothing here is ever updated, which
-- matches how `payments` and `expenses` already work. `amount` is signed —
-- positive for purchase and bonus, negative for usage — so the balance is
-- reconcilable by summing it.
-- ---------------------------------------------------------------------------

create table if not exists sms_credit_transactions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references groups (id) on delete cascade,
  type            text not null check (type in ('purchase', 'usage', 'bonus')),
  amount          integer not null,
  description     text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists sms_credit_transactions_org_idx
  on sms_credit_transactions (organization_id, created_at desc);

-- The monthly-spend check scans this by month, per group.
create index if not exists sms_credit_transactions_spend_idx
  on sms_credit_transactions (organization_id, created_at)
  where type in ('usage', 'bonus');

alter table sms_credit_transactions enable row level security;

-- Money, so treasurer and up. Same bar as the expense ledger.
create policy sms_credit_transactions_read on sms_credit_transactions
  for select using (has_group_role(organization_id, 'treasurer'));

-- ---------------------------------------------------------------------------
-- Purchases
--
-- Written by fmt-ss-backend, twice: a `pending` row when the Paystack checkout
-- is initialised, promoted to `success` by whichever of the webhook or the
-- verify call arrives first. `gateway_reference` is unique, and that uniqueness
-- IS the idempotency — it is the only thing stopping one payment being credited
-- twice when both paths run.
-- ---------------------------------------------------------------------------

create table if not exists payment_records (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references groups (id) on delete cascade,
  user_id           uuid references auth.users (id) on delete set null,
  amount_paid       numeric(10, 2) not null,
  currency          text not null default 'GHS',
  credits_purchased integer not null,
  payment_gateway   text not null default 'paystack',
  gateway_reference text not null unique,
  status            text not null check (status in ('pending', 'success', 'failed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists payment_records_org_idx
  on payment_records (organization_id, created_at desc);

alter table payment_records enable row level security;

-- Buying credit is an admin act, and the receipt names who paid.
create policy payment_records_read on payment_records
  for select using (has_group_role(organization_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Every group has a balance row, from the moment it exists
--
-- The backend's credit pre-flight does `.single()` on this table and treats a
-- missing row as "could not verify balance", which reads to a user as a broken
-- app rather than an empty wallet. A group with no row would also never appear
-- in the admin console's balance list. So the row exists from birth, at zero.
-- ---------------------------------------------------------------------------

create function ensure_group_sms_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into organization_sms_balances (organization_id) values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists groups_sms_balance on groups;
create trigger groups_sms_balance
  after insert on groups
  for each row execute function ensure_group_sms_balance();

insert into organization_sms_balances (organization_id)
select id from groups
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- Adding credit — called by fmt-ss-backend after Paystack confirms
--
-- One statement moves the balance and one insert records why, inside one
-- transaction. The backend has a non-atomic fallback for app databases without
-- this RPC (read, add, write); it is a race waiting to happen and this exists
-- so Kobox never takes it.
--
-- NOT idempotent on its own — `payment_records.gateway_reference` is what stops
-- a double credit, and the backend checks it before calling here.
-- ---------------------------------------------------------------------------

create function add_sms_credits(
  p_org_id      uuid,
  p_credits     integer,
  p_description text default 'SMS credit purchase',
  p_metadata    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  if p_credits is null or p_credits <= 0 then
    raise exception 'add_sms_credits needs a positive number of credits, got %', p_credits;
  end if;

  insert into organization_sms_balances (organization_id, credit_balance)
  values (p_org_id, p_credits)
  on conflict (organization_id) do update
    set credit_balance = organization_sms_balances.credit_balance + excluded.credit_balance,
        updated_at     = now()
  returning credit_balance into v_new_balance;

  insert into sms_credit_transactions (organization_id, type, amount, description, metadata)
  values (p_org_id, 'purchase', p_credits, p_description, coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object('success', true, 'new_balance', v_new_balance);
end;
$$;

-- ---------------------------------------------------------------------------
-- Spending credit — called by fmt-ss-backend once Arkesel has ACCEPTED the send
--
-- Never before. The backend deliberately deducts after the provider confirms,
-- so a rejected sender ID or a blacklisted number costs nothing.
--
-- `p_message_count` is CREDITS, not messages: a message is billed per 160-char
-- GSM-7 segment per recipient, so one 200-character text to one person is two.
-- Getting that wrong in the other direction is why the dispatcher normalises
-- typographic characters before sending — a single curly quote drops the limit
-- to 70 and triples the bill.
--
-- The overdraft is deliberate and inherited from print-calc-pro: a multipart
-- message that costs more than the remaining balance is SENT and the shortfall
-- recorded as `bonus`. Truncating somebody's receipt halfway to save one credit
-- is not a trade worth making, and the balance floor keeps it bounded.
-- ---------------------------------------------------------------------------

create function deduct_sms_credits(
  p_org_id        uuid,
  p_message_count integer,
  p_recipient     text,
  p_payload       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_bonus   integer;
  v_new     integer;
  v_covered integer;
  v_short   integer := 0;
begin
  -- Created here rather than raising, so a group that somehow has no row still
  -- gets an honest ledger instead of a send nobody was charged for.
  insert into organization_sms_balances (organization_id) values (p_org_id)
  on conflict (organization_id) do nothing;

  select credit_balance, bonus_credits_received
    into v_balance, v_bonus
    from organization_sms_balances
   where organization_id = p_org_id
     for update;

  v_new := v_balance - p_message_count;
  if v_new < 0 then
    v_short := abs(v_new);
    v_new   := 0;
  end if;
  v_covered := p_message_count - v_short;

  update organization_sms_balances
     set credit_balance         = v_new,
         bonus_credits_received = v_bonus + v_short,
         updated_at             = now()
   where organization_id = p_org_id;

  if v_covered > 0 then
    insert into sms_credit_transactions (organization_id, type, amount, description, metadata)
    values (p_org_id, 'usage', -v_covered,
            'SMS sent to ' || coalesce(p_recipient, 'unknown'),
            coalesce(p_payload, '{}'::jsonb));
  end if;

  if v_short > 0 then
    insert into sms_credit_transactions (organization_id, type, amount, description, metadata)
    values (p_org_id, 'bonus', v_short,
            'Bonus coverage for multipart SMS to ' || coalesce(p_recipient, 'unknown'),
            coalesce(p_payload, '{}'::jsonb));
  end if;

  return jsonb_build_object(
    'success',        true,
    'new_balance',    v_new,
    'usage_deducted', v_covered,
    'bonus_applied',  v_short
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery receipts
--
-- Arkesel calls fmt-ss-backend's webhook, which calls this with the `ref` the
-- dispatcher passed as `messageRef` — a `notifications.id`. Without it, "sent"
-- means only "the provider accepted it", which is not the same claim and is not
-- the one a treasurer chasing an unpaid member needs.
--
-- Statuses vary by carrier, so the report is stored verbatim (upper-cased)
-- rather than mapped onto a guess at what each one means.
--
-- `p_recipient` is unused and cannot be dropped: the argument list is the
-- backend's, and the row already knows which number it went to.
-- ---------------------------------------------------------------------------

alter table notifications
  add column if not exists sms_status    text,
  add column if not exists sms_status_at timestamptz;

comment on column notifications.sms_status is
  'Arkesel delivery report, e.g. DELIVERED / FAILED. NULL until one arrives.';

create function record_sms_delivery(
  p_ref       text,
  p_recipient text,
  p_status    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  begin
    v_id := p_ref::uuid;
  exception when invalid_text_representation then
    return;
  end;

  update notifications
     set sms_status    = upper(p_status),
         sms_status_at = now()
   where id = v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sender ID requests
--
-- A sender ID is what the recipient sees instead of a number. It has to be
-- registered with the networks, which is a human process, so this table is a
-- request queue an FMT administrator works through — not something the app can
-- grant itself.
--
-- Three per group, matching print-calc-pro. Approving one adopts it if the
-- group has none; rejecting or deleting the one in use falls back to the next
-- approved one, or to NULL, which means the platform default. A group is never
-- left pointing at a sender ID it may not use.
-- ---------------------------------------------------------------------------

do $$ begin
  create type sender_id_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

create table if not exists sender_id_requests (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references groups (id) on delete cascade,
  -- Arkesel's own limit. Enforced here so a request that cannot succeed is
  -- refused at the point somebody types it, not weeks later by a person.
  sender_id        varchar(11) not null check (length(trim(sender_id)) > 0),
  reason           text not null check (length(trim(reason)) > 0),
  status           sender_id_status not null default 'pending',
  rejection_reason text,
  requested_by     uuid references group_members (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (group_id, sender_id)
);

create index if not exists sender_id_requests_group_idx
  on sender_id_requests (group_id, created_at desc);

create function check_max_sender_ids()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  -- Rejected requests do not consume the quota. Counting them would let three
  -- refusals lock a group out of ever asking again, which is the opposite of
  -- what a refusal should mean.
  select count(*) into v_count
    from sender_id_requests
   where group_id = new.group_id
     and status <> 'rejected';

  if v_count >= 3 then
    raise exception 'A group may hold at most 3 sender IDs';
  end if;
  return new;
end;
$$;

drop trigger if exists sender_id_requests_max on sender_id_requests;
create trigger sender_id_requests_max
  before insert on sender_id_requests
  for each row execute function check_max_sender_ids();

create function handle_sender_id_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current varchar(11);
  v_next    varchar(11);
begin
  select sms_sender_id into v_current from groups where id = new.group_id;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    if v_current is null or v_current = '' then
      update groups set sms_sender_id = new.sender_id where id = new.group_id;
    end if;
  end if;

  if new.status = 'rejected' and old.status = 'approved' and v_current = new.sender_id then
    select sender_id into v_next from sender_id_requests
     where group_id = new.group_id and status = 'approved' and id <> new.id
     order by created_at limit 1;
    update groups set sms_sender_id = v_next where id = new.group_id;
  end if;

  return new;
end;
$$;

drop trigger if exists sender_id_requests_status on sender_id_requests;
create trigger sender_id_requests_status
  after update on sender_id_requests
  for each row execute function handle_sender_id_status_change();

create function handle_sender_id_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current varchar(11);
  v_next    varchar(11);
begin
  select sms_sender_id into v_current from groups where id = old.group_id;
  if v_current = old.sender_id then
    select sender_id into v_next from sender_id_requests
     where group_id = old.group_id and status = 'approved' and id <> old.id
     order by created_at limit 1;
    update groups set sms_sender_id = v_next where id = old.group_id;
  end if;
  return old;
end;
$$;

drop trigger if exists sender_id_requests_deleted on sender_id_requests;
create trigger sender_id_requests_deleted
  after delete on sender_id_requests
  for each row execute function handle_sender_id_deletion();

alter table sender_id_requests enable row level security;

-- Any member may see what name their messages arrive under.
create policy sender_id_requests_read on sender_id_requests
  for select using (is_group_member(group_id));

-- Requesting and withdrawing are admin acts. Note there is no policy allowing
-- `status` to be changed: only an FMT administrator, through the service role,
-- approves. An admin who could approve their own request could send as anyone.
create policy sender_id_requests_insert on sender_id_requests
  for insert with check (
    has_group_role(group_id, 'admin')
    and status = 'pending'
  );

create policy sender_id_requests_delete on sender_id_requests
  for delete using (has_group_role(group_id, 'admin'));

-- ---------------------------------------------------------------------------
-- The compatibility view the admin console reads
--
-- fmt-ss-backend's SMS console walks every registered app and runs the same
-- query against each: `organizations` → id, name, email, phone, is_active,
-- sms_sender_id. Kobox has no such table, and adding one would mean two records
-- of every group.
--
-- A view costs nothing and makes Kobox a first-class citizen of the console:
-- balances, low-balance alerts and the alert SMS all work unchanged. The
-- contact details are the OWNER's, because a low-balance warning has to reach
-- somebody who can act on it, and the owner is the only role every group is
-- guaranteed to have.
--
-- `is_active` is a constant: Kobox has no notion of a deactivated group. A
-- group that is finished is deleted.
-- ---------------------------------------------------------------------------

create or replace view organizations as
  select
    g.id,
    g.name,
    owner.email                        as email,
    coalesce(owner.phone_e164, owner.phone) as phone,
    true                               as is_active,
    g.sms_sender_id,
    g.created_at,
    g.updated_at
  from groups g
  left join lateral (
    select m.email, m.phone, m.phone_e164
    from group_members m
    where m.group_id = g.id
      and m.role = 'owner'
      and m.status = 'active'
    order by m.joined_at
    limit 1
  ) owner on true;

comment on view organizations is
  'Compatibility shim for fmt-ss-backend''s admin console. A Kobox group IS an '
  'organization; contact details are the group owner''s. Service role only.';

-- Read by the service role only. It exposes one member''s phone and email to
-- anyone who can select it, and no app screen has any business doing that —
-- every in-app view of a group already goes through group_members and RLS.
revoke all on organizations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The gate, rewritten around money
--
-- Two changes, both correcting the same misunderstanding.
--
-- 1. The cap counted OUTBOX ROWS. Arkesel charges per 160-character GSM-7
--    segment per recipient, so a cap of 200 "messages" was a cap of somewhere
--    between 200 and 600 credits depending on how long the group's name is.
--    It now counts what is actually billed, read from the ledger the backend
--    writes — not a second counter of our own.
-- 2. SMS was gated on an id nobody had filled in. It is now gated on having
--    credit, which is the thing that can actually run out.
-- ---------------------------------------------------------------------------

create or replace function group_sms_used_this_month(p_group_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  -- Usage is negative and bonus positive; both are credits spent on this
  -- group's behalf, so both count against the cap.
  select coalesce(sum(abs(amount)), 0)::int
  from sms_credit_transactions
  where organization_id = p_group_id
    and type in ('usage', 'bonus')
    and created_at >= date_trunc('month', now());
$$;

create or replace function group_can_send_sms(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from groups g
    join organization_sms_balances b on b.organization_id = g.id
    where g.id = p_group_id
      and g.sms_enabled
      -- No credit, no SMS. Push carries on regardless.
      and b.credit_balance > 0
      and group_sms_used_this_month(g.id) < g.sms_monthly_cap
  );
$$;

-- ---------------------------------------------------------------------------
-- What the app is allowed to call
-- ---------------------------------------------------------------------------

-- The credit RPCs belong to fmt-ss-backend and the service role alone. An app
-- that could call `add_sms_credits` could mint credit without paying, and one
-- that could call `deduct_sms_credits` could empty a rival group's wallet.
revoke execute on function add_sms_credits(uuid, integer, text, jsonb) from anon, authenticated;
revoke execute on function deduct_sms_credits(uuid, integer, text, jsonb) from anon, authenticated;
revoke execute on function record_sms_delivery(text, text, text) from anon, authenticated;

grant execute on function group_sms_used_this_month(uuid) to authenticated;
grant execute on function group_can_send_sms(uuid) to authenticated;
