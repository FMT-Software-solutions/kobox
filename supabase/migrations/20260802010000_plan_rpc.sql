-- Plan creation, cycle generation and obligation issuing.
--
-- A plan on its own owes nobody anything. What members actually see is the
-- obligation issued to them for a cycle, so creating a plan must also open its
-- first cycle and issue obligations — in one transaction, or a group ends up
-- with a plan that silently collects nothing.

-- Where a cycle starting on p_start ends, given the plan's frequency.
create function cycle_end_for(p_frequency plan_frequency, p_start date)
returns date
language sql
immutable
as $$
  select case p_frequency
    when 'daily'     then p_start
    when 'weekly'    then p_start + 6
    when 'biweekly'  then p_start + 13
    when 'monthly'   then (p_start + interval '1 month')::date - 1
    when 'quarterly' then (p_start + interval '3 months')::date - 1
    when 'yearly'    then (p_start + interval '1 year')::date - 1
    when 'once'      then p_start
  end;
$$;

-- A label a member would recognise, not an ISO range.
create function cycle_label_for(p_frequency plan_frequency, p_start date)
returns text
language sql
immutable
as $$
  select case p_frequency
    when 'daily'     then to_char(p_start, 'FMDD Mon YYYY')
    when 'weekly'    then 'Week of ' || to_char(p_start, 'FMDD Mon YYYY')
    when 'biweekly'  then 'Fortnight from ' || to_char(p_start, 'FMDD Mon YYYY')
    when 'monthly'   then to_char(p_start, 'FMMonth YYYY')
    when 'quarterly' then 'Q' || to_char(p_start, 'Q') || ' ' || to_char(p_start, 'YYYY')
    when 'yearly'    then to_char(p_start, 'YYYY')
    when 'once'      then 'One time'
  end;
$$;

/**
 * Opens a cycle for a plan and issues an obligation to every active member.
 *
 * Amount precedence: a per-member override wins over the plan default. An
 * override row with a NULL amount means the member is exempt and gets no
 * obligation at all — that is how a group excuses its elderly or bereaved
 * members without deleting them or corrupting the collection rate.
 *
 * 'open' plans issue no obligations: members give what they wish.
 */
create function generate_cycle(p_plan_id uuid, p_period_start date default null)
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
    'open'
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

create function create_plan(
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

  -- Open the first cycle immediately so the plan starts collecting.
  perform generate_cycle(v_plan.id, v_start);

  return v_plan;
end;
$$;

grant execute on function create_plan(uuid, text, plan_kind, plan_frequency, bigint, int, date) to authenticated;
grant execute on function generate_cycle(uuid, date) to authenticated;
revoke execute on function cycle_end_for(plan_frequency, date) from anon;
revoke execute on function cycle_label_for(plan_frequency, date) from anon;
