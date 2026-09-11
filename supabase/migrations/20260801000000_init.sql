-- Kobox initial schema.
--
-- Design rules enforced here, not just in the app:
--   * All money is BIGINT in minor units (pesewas). No numeric, no float, ever.
--   * Confirmed payments are append-only. Corrections insert a reversing row.
--   * Every table carries group_id (directly or via parent) so RLS can isolate tenants.
--   * Balances are derived in views, never stored as a running total.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type member_role   as enum ('owner', 'admin', 'treasurer', 'auditor', 'member');
create type member_status as enum ('active', 'invited', 'suspended', 'left');
create type plan_kind     as enum ('dues', 'contribution', 'levy', 'open', 'rotating', 'savings');
create type plan_frequency as enum ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'once');
create type plan_status   as enum ('draft', 'active', 'paused', 'ended');
create type cycle_status  as enum ('upcoming', 'open', 'closed');
create type payment_method as enum ('cash', 'momo', 'bank', 'cheque', 'card', 'other');
create type payment_status as enum ('pending', 'confirmed', 'rejected', 'reversed');
create type expense_status as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- Profiles — one row per auth user
-- ---------------------------------------------------------------------------

create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Keep profiles in step with auth.users automatically.
create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Groups & membership
-- ---------------------------------------------------------------------------

create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  join_code   text not null unique,
  currency    text not null default 'GHS' check (currency ~ '^[A-Z]{3}$'),
  timezone    text not null default 'Africa/Accra',
  logo_url    text,
  created_by  uuid not null references auth.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id) on delete cascade,
  -- Null for members who have no Kobox account. Many members never install the
  -- app; the treasurer still records their payments.
  user_id    uuid references auth.users (id) on delete set null,
  full_name  text not null check (length(trim(full_name)) > 0),
  phone      text,
  email      text,
  avatar_url text,
  role       member_role not null default 'member',
  status     member_status not null default 'active',
  joined_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A user can hold at most one membership per group.
  unique (group_id, user_id)
);

create index group_members_group_idx on group_members (group_id);
create index group_members_user_idx  on group_members (user_id);

-- ---------------------------------------------------------------------------
-- RLS helper functions
--
-- These are SECURITY DEFINER so they bypass RLS internally. Without that, a
-- policy on group_members that itself queries group_members recurses infinitely.
-- ---------------------------------------------------------------------------

create function role_rank(r member_role)
returns int
language sql
immutable
as $$
  select case r
    when 'owner'     then 5
    when 'admin'     then 4
    when 'treasurer' then 3
    when 'auditor'   then 2
    when 'member'    then 1
  end;
$$;

create function is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = gid
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

-- True when the caller holds at least `min_role` in the group.
create function has_group_role(gid uuid, min_role member_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where group_id = gid
      and user_id = auth.uid()
      and status = 'active'
      and role_rank(role) >= role_rank(min_role)
  );
$$;

-- The caller's member row in a group, used to attribute records.
create function current_member_id(gid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from group_members
  where group_id = gid
    and user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Plans & cycles
-- ---------------------------------------------------------------------------

create table plans (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups (id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  kind           plan_kind not null,
  frequency      plan_frequency not null,
  status         plan_status not null default 'active',
  default_amount bigint check (default_amount is null or default_amount > 0),
  start_date     date not null,
  end_date       date,
  grace_days     int not null default 0 check (grace_days >= 0),
  created_by     uuid not null references group_members (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  -- Only 'open' plans may leave the amount unset.
  check ((kind = 'open') or (default_amount is not null))
);

create index plans_group_idx on plans (group_id);

create table plan_member_overrides (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid not null references plans (id) on delete cascade,
  member_id uuid not null references group_members (id) on delete cascade,
  -- Null means exempt from this plan entirely.
  amount    bigint check (amount is null or amount >= 0),
  reason    text,
  unique (plan_id, member_id)
);

create table cycles (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references plans (id) on delete cascade,
  label        text not null,
  period_start date not null,
  period_end   date not null,
  due_date     date not null,
  status       cycle_status not null default 'upcoming',
  created_at   timestamptz not null default now(),
  check (period_end >= period_start),
  unique (plan_id, period_start)
);

create index cycles_plan_idx on cycles (plan_id);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table obligations (
  id           uuid primary key default gen_random_uuid(),
  cycle_id     uuid not null references cycles (id) on delete cascade,
  member_id    uuid not null references group_members (id) on delete cascade,
  amount_due   bigint not null check (amount_due >= 0),
  waived       boolean not null default false,
  waived_reason text,
  created_at   timestamptz not null default now(),
  unique (cycle_id, member_id)
);

create index obligations_member_idx on obligations (member_id);

create table payments (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references groups (id) on delete cascade,
  member_id     uuid not null references group_members (id) on delete restrict,
  amount        bigint not null check (amount <> 0),
  method        payment_method not null,
  status        payment_status not null default 'pending',
  paid_at       timestamptz not null default now(),
  reference     text,
  note          text,
  receipt_url   text,
  recorded_by   uuid not null references group_members (id),
  confirmed_by  uuid references group_members (id),
  reverses_payment_id uuid references payments (id),
  created_at    timestamptz not null default now()
);

create index payments_group_idx  on payments (group_id, paid_at desc);
create index payments_member_idx on payments (member_id, paid_at desc);

create table allocations (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references payments (id) on delete cascade,
  -- Null for unallocated money: open-plan giving, or credit held on account.
  obligation_id uuid references obligations (id) on delete set null,
  plan_id       uuid references plans (id) on delete set null,
  amount        bigint not null check (amount <> 0),
  created_at    timestamptz not null default now()
);

create index allocations_payment_idx    on allocations (payment_id);
create index allocations_obligation_idx on allocations (obligation_id);

create table expenses (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  category    text not null default 'general',
  amount      bigint not null check (amount > 0),
  status      expense_status not null default 'pending',
  spent_at    timestamptz not null default now(),
  note        text,
  receipt_url text,
  recorded_by uuid not null references group_members (id),
  approved_by uuid references group_members (id),
  created_at  timestamptz not null default now()
);

create index expenses_group_idx on expenses (group_id, spent_at desc);

create table rotation_slots (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references plans (id) on delete cascade,
  cycle_id        uuid not null references cycles (id) on delete cascade,
  member_id       uuid not null references group_members (id) on delete cascade,
  position        int not null check (position > 0),
  expected_payout bigint not null check (expected_payout >= 0),
  paid_out_amount bigint check (paid_out_amount >= 0),
  paid_out_at     timestamptz,
  unique (plan_id, position),
  unique (cycle_id)
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
--
-- A confirmed payment is a financial record. Editing or deleting one would let
-- history be rewritten silently, which defeats the entire point of the app.
-- ---------------------------------------------------------------------------

create function protect_confirmed_payments()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('confirmed', 'reversed') then
      raise exception 'Confirmed payments cannot be deleted. Insert a reversing payment instead.';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' and new.status not in ('confirmed', 'reversed') then
    raise exception 'A confirmed payment may only move to reversed.';
  end if;

  if old.status in ('confirmed', 'reversed') then
    if new.amount    is distinct from old.amount
    or new.member_id is distinct from old.member_id
    or new.method    is distinct from old.method
    or new.paid_at   is distinct from old.paid_at then
      raise exception 'Confirmed payment details are immutable. Insert a reversing payment instead.';
    end if;
  end if;

  return new;
end;
$$;

create trigger payments_append_only
  before update or delete on payments
  for each row execute function protect_confirmed_payments();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch      before update on profiles      for each row execute function touch_updated_at();
create trigger groups_touch        before update on groups        for each row execute function touch_updated_at();
create trigger group_members_touch before update on group_members for each row execute function touch_updated_at();
create trigger plans_touch         before update on plans         for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Derived views — the app never computes balances itself
-- ---------------------------------------------------------------------------

-- Confirmed money settled against each obligation.
create view obligation_balances
with (security_invoker = true)
as
select
  o.id            as obligation_id,
  o.cycle_id,
  o.member_id,
  o.amount_due,
  coalesce(sum(a.amount) filter (where p.status = 'confirmed'), 0)::bigint as amount_paid,
  (o.amount_due - coalesce(sum(a.amount) filter (where p.status = 'confirmed'), 0))::bigint as balance
from obligations o
left join allocations a on a.obligation_id = o.id
left join payments    p on p.id = a.payment_id
where o.waived = false
group by o.id;

-- Headline figures per group.
create view group_summaries
with (security_invoker = true)
as
select
  g.id as group_id,
  coalesce((
    select sum(p.amount) from payments p
    where p.group_id = g.id and p.status = 'confirmed'
  ), 0)::bigint as total_collected,
  coalesce((
    select sum(e.amount) from expenses e
    where e.group_id = g.id and e.status = 'approved'
  ), 0)::bigint as total_expenses,
  coalesce((
    select sum(p.amount) from payments p
    where p.group_id = g.id and p.status = 'confirmed'
  ), 0)::bigint
  - coalesce((
    select sum(e.amount) from expenses e
    where e.group_id = g.id and e.status = 'approved'
  ), 0)::bigint as cash_on_hand,
  (
    select count(*) from group_members m
    where m.group_id = g.id and m.status = 'active'
  )::int as active_members
from groups g;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Everything is deny-by-default. A member can only ever see their own group's
-- rows, and only privileged roles can alter the books.
-- ---------------------------------------------------------------------------

alter table profiles              enable row level security;
alter table groups                enable row level security;
alter table group_members         enable row level security;
alter table plans                 enable row level security;
alter table plan_member_overrides enable row level security;
alter table cycles                enable row level security;
alter table obligations           enable row level security;
alter table payments              enable row level security;
alter table allocations           enable row level security;
alter table expenses              enable row level security;
alter table rotation_slots        enable row level security;

-- Profiles are private to their owner. Other members' display names live on
-- group_members, so nothing needs to read across profiles.
create policy profiles_select_self on profiles
  for select using (id = auth.uid());

create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Groups
create policy groups_select on groups
  for select using (is_group_member(id));

create policy groups_insert on groups
  for insert with check (created_by = auth.uid());

create policy groups_update on groups
  for update using (has_group_role(id, 'admin')) with check (has_group_role(id, 'admin'));

create policy groups_delete on groups
  for delete using (has_group_role(id, 'owner'));

-- Group members
create policy group_members_select on group_members
  for select using (is_group_member(group_id));

create policy group_members_insert on group_members
  for insert with check (
    -- Admins add members, and the group creator seeds their own first row.
    has_group_role(group_id, 'admin')
    or exists (select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  );

create policy group_members_update on group_members
  for update using (has_group_role(group_id, 'admin'))
  with check (has_group_role(group_id, 'admin'));

create policy group_members_delete on group_members
  for delete using (has_group_role(group_id, 'admin'));

-- Plans
create policy plans_select on plans
  for select using (is_group_member(group_id));

create policy plans_write on plans
  for all using (has_group_role(group_id, 'admin'))
  with check (has_group_role(group_id, 'admin'));

-- Plan overrides follow their plan's group.
create policy plan_overrides_select on plan_member_overrides
  for select using (
    exists (select 1 from plans p where p.id = plan_id and is_group_member(p.group_id))
  );

create policy plan_overrides_write on plan_member_overrides
  for all using (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'admin'))
  )
  with check (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'admin'))
  );

-- Cycles
create policy cycles_select on cycles
  for select using (
    exists (select 1 from plans p where p.id = plan_id and is_group_member(p.group_id))
  );

create policy cycles_write on cycles
  for all using (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'treasurer'))
  )
  with check (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'treasurer'))
  );

-- Obligations
create policy obligations_select on obligations
  for select using (
    exists (
      select 1 from cycles c
      join plans p on p.id = c.plan_id
      where c.id = cycle_id and is_group_member(p.group_id)
    )
  );

create policy obligations_write on obligations
  for all using (
    exists (
      select 1 from cycles c
      join plans p on p.id = c.plan_id
      where c.id = cycle_id and has_group_role(p.group_id, 'treasurer')
    )
  )
  with check (
    exists (
      select 1 from cycles c
      join plans p on p.id = c.plan_id
      where c.id = cycle_id and has_group_role(p.group_id, 'treasurer')
    )
  );

-- Payments: everyone in the group sees them (transparency is the product).
create policy payments_select on payments
  for select using (is_group_member(group_id));

-- A member may record their own payment, which lands as 'pending'.
-- A treasurer may record anyone's.
create policy payments_insert on payments
  for insert with check (
    has_group_role(group_id, 'treasurer')
    or (member_id = current_member_id(group_id) and status = 'pending')
  );

create policy payments_update on payments
  for update using (has_group_role(group_id, 'treasurer'))
  with check (has_group_role(group_id, 'treasurer'));

create policy payments_delete on payments
  for delete using (has_group_role(group_id, 'admin'));

-- Allocations follow their payment.
create policy allocations_select on allocations
  for select using (
    exists (select 1 from payments p where p.id = payment_id and is_group_member(p.group_id))
  );

create policy allocations_write on allocations
  for all using (
    exists (select 1 from payments p where p.id = payment_id and has_group_role(p.group_id, 'treasurer'))
  )
  with check (
    exists (select 1 from payments p where p.id = payment_id and has_group_role(p.group_id, 'treasurer'))
  );

-- Expenses
create policy expenses_select on expenses
  for select using (is_group_member(group_id));

create policy expenses_insert on expenses
  for insert with check (has_group_role(group_id, 'treasurer'));

create policy expenses_update on expenses
  for update using (has_group_role(group_id, 'admin'))
  with check (has_group_role(group_id, 'admin'));

create policy expenses_delete on expenses
  for delete using (has_group_role(group_id, 'admin'));

-- Rotation slots
create policy rotation_slots_select on rotation_slots
  for select using (
    exists (select 1 from plans p where p.id = plan_id and is_group_member(p.group_id))
  );

create policy rotation_slots_write on rotation_slots
  for all using (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'treasurer'))
  )
  with check (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'treasurer'))
  );
