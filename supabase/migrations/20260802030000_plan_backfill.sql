-- Backfill every cycle a plan owes since its start date.
--
-- A group that begins using Kobox in August but whose dues actually started in
-- April must show four months owed, not one. Previously create_plan opened only
-- the first cycle, so any plan with a past start date silently under-billed.

-- Where the cycle after one starting on p_start begins. NULL for one-off plans.
create function next_cycle_start(p_frequency plan_frequency, p_start date)
returns date
language sql
immutable
as $$
  select case p_frequency
    when 'daily'     then p_start + 1
    when 'weekly'    then p_start + 7
    when 'biweekly'  then p_start + 14
    when 'monthly'   then (p_start + interval '1 month')::date
    when 'quarterly' then (p_start + interval '3 months')::date
    when 'yearly'    then (p_start + interval '1 year')::date
    when 'once'      then null
  end;
$$;

-- A past cycle is closed but still owed; arrears live on the obligation, not
-- the cycle, so closing it never forgives a debt.
create or replace function generate_cycle(p_plan_id uuid, p_period_start date default null)
returns cycles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_start date;
  v_end date;
  v_cycle cycles;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'treasurer') then
    raise exception 'Only a treasurer or above can open a cycle';
  end if;

  v_start := coalesce(p_period_start, v_plan.start_date);
  v_end := cycle_end_for(v_plan.frequency, v_start);

  -- Opening the same period twice is a no-op rather than an error, so a retried
  -- request cannot double-bill the whole group.
  select * into v_cycle from cycles where plan_id = p_plan_id and period_start = v_start;
  if v_cycle.id is not null then
    return v_cycle;
  end if;

  insert into cycles (plan_id, label, period_start, period_end, due_date, status)
  values (
    p_plan_id,
    cycle_label_for(v_plan.frequency, v_start),
    v_start,
    v_end,
    v_end,
    case when v_end < current_date then 'closed'::cycle_status else 'open'::cycle_status end
  )
  returning * into v_cycle;

  if v_plan.kind <> 'open' then
    insert into obligations (cycle_id, member_id, amount_due)
    select
      v_cycle.id,
      m.id,
      coalesce(o.amount, v_plan.default_amount)
    from group_members m
    left join plan_member_overrides o
      on o.plan_id = p_plan_id and o.member_id = m.id
    where m.group_id = v_plan.group_id
      and m.status = 'active'
      -- An override row that exists with a NULL amount means exempt.
      and not (o.id is not null and o.amount is null)
      and coalesce(o.amount, v_plan.default_amount) is not null;
  end if;

  return v_cycle;
end;
$$;

/**
 * Opens every cycle from the plan's start date up to p_up_to (today by default).
 * Safe to re-run: generate_cycle skips periods that already exist, so this
 * doubles as the "catch up any missed periods" routine.
 *
 * Returns how many cycles now exist in that range.
 */
create function generate_due_cycles(p_plan_id uuid, p_up_to date default current_date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_start date;
  v_next date;
  v_count int := 0;
  -- A guard against an accidental start date decades in the past on a daily
  -- plan generating tens of thousands of rows.
  c_max_cycles constant int := 520;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  v_start := v_plan.start_date;

  loop
    exit when v_start > p_up_to;
    exit when v_plan.end_date is not null and v_start > v_plan.end_date;

    perform generate_cycle(p_plan_id, v_start);
    v_count := v_count + 1;

    if v_count >= c_max_cycles then
      raise exception
        'That start date would create more than % collection periods. Choose a later start date.',
        c_max_cycles;
    end if;

    v_next := next_cycle_start(v_plan.frequency, v_start);
    exit when v_next is null;      -- one-off plans have a single cycle
    exit when v_next <= v_start;   -- defensive: never loop forever
    v_start := v_next;
  end loop;

  return v_count;
end;
$$;

-- create_plan now backfills instead of opening a single cycle.
create or replace function create_plan(
  p_group_id uuid,
  p_name text,
  p_kind plan_kind,
  p_frequency plan_frequency,
  p_default_amount bigint default null,
  p_grace_days int default 0,
  p_start_date date default null
)
returns plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_plan plans;
  v_start date := coalesce(p_start_date, current_date);
begin
  v_member_id := current_member_id(p_group_id);
  if v_member_id is null then
    raise exception 'Not a member of this group';
  end if;

  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can create a contribution plan';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the plan a name';
  end if;

  if p_kind <> 'open' and coalesce(p_default_amount, 0) <= 0 then
    raise exception 'Set how much each member contributes';
  end if;

  if v_start > current_date + interval '1 year' then
    raise exception 'That start date is too far in the future';
  end if;

  insert into plans (
    group_id, name, kind, frequency, status,
    default_amount, start_date, grace_days, created_by
  )
  values (
    p_group_id, trim(p_name), p_kind, p_frequency, 'active',
    case when p_kind = 'open' then null else p_default_amount end,
    v_start, greatest(p_grace_days, 0), v_member_id
  )
  returning * into v_plan;

  -- Open every period from the start date to today, so a plan backdated to
  -- April immediately shows each month owed.
  perform generate_due_cycles(v_plan.id);

  return v_plan;
end;
$$;

grant execute on function generate_due_cycles(uuid, date) to authenticated;
revoke execute on function next_cycle_start(plan_frequency, date) from anon;
