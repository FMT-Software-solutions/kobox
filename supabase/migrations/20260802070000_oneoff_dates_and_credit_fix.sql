-- One-off collection windows, and a credit-reporting fix.

/*
 * BUG FIX: member_standings.credit counted every allocation with no obligation,
 * which includes designated giving to an open contribution. Money given to an
 * emergency appeal was therefore reported as unspent credit, and the dashboard
 * told the member it covered future months of dues.
 *
 * Only general credit — no obligation AND no plan — is money still waiting to be
 * claimed. Designated giving has already reached its destination.
 */
create or replace view member_standings
with (security_invoker = true)
as
select
  m.id                                                          as member_id,
  m.group_id,
  coalesce(b.total_due, 0)::bigint                              as total_due,
  coalesce(b.total_paid, 0)::bigint                             as total_paid,
  (coalesce(b.total_due, 0) - coalesce(b.total_paid, 0))::bigint as balance,
  coalesce(cr.credit, 0)::bigint                                as credit
from group_members m
left join (
  select
    member_id,
    sum(amount_due)  as total_due,
    sum(amount_paid) as total_paid
  from obligation_balances
  group by member_id
) b on b.member_id = m.id
left join (
  select p.member_id, sum(a.amount) as credit
  from allocations a
  join payments p on p.id = a.payment_id
  where a.obligation_id is null
    and a.plan_id is null          -- general credit only
    and a.amount > 0
    and p.status = 'confirmed'
  group by p.member_id
) cr on cr.member_id = m.id;

/*
 * A one-off collection is announced on a date and closes on a date. Recurring
 * plans derive their period end from the frequency, but "once" has no natural
 * length — so it uses the plan's end_date as the deadline, which is what the
 * grace period then counts from.
 */
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
  r_member record;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'treasurer') then
    raise exception 'Only a treasurer or above can open a cycle';
  end if;

  v_start := coalesce(p_period_start, v_plan.start_date);

  if v_plan.frequency = 'once' then
    v_end := coalesce(v_plan.end_date, v_start);
  else
    v_end := cycle_end_for(v_plan.frequency, v_start);
  end if;

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
      and not (o.id is not null and o.amount is null)
      and coalesce(o.amount, v_plan.default_amount) is not null;

    for r_member in
      select distinct p.member_id
      from allocations a
      join payments p on p.id = a.payment_id
      where a.obligation_id is null
        and a.plan_id is null
        and a.amount > 0
        and p.group_id = v_plan.group_id
        and p.status = 'confirmed'
    loop
      perform apply_credit(r_member.member_id);
    end loop;
  end if;

  return v_cycle;
end;
$$;

-- create_plan and update_plan gain an end date, used as the deadline for one-offs.
create or replace function create_plan(
  p_group_id uuid,
  p_name text,
  p_kind plan_kind,
  p_frequency plan_frequency,
  p_default_amount bigint default null,
  p_grace_days int default 0,
  p_start_date date default null,
  p_end_date date default null
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

  if p_end_date is not null and p_end_date < v_start then
    raise exception 'The closing date cannot be before the start date';
  end if;

  if v_start > current_date + interval '1 year' then
    raise exception 'That start date is too far in the future';
  end if;

  insert into plans (
    group_id, name, kind, frequency, status,
    default_amount, start_date, end_date, grace_days, created_by
  )
  values (
    p_group_id, trim(p_name), p_kind, p_frequency, 'active',
    case when p_kind = 'open' then null else p_default_amount end,
    v_start, p_end_date, greatest(p_grace_days, 0), v_member_id
  )
  returning * into v_plan;

  perform generate_due_cycles(v_plan.id);

  return v_plan;
end;
$$;

grant execute on function create_plan(uuid, text, plan_kind, plan_frequency, bigint, int, date, date) to authenticated;

create or replace function update_plan(
  p_plan_id uuid,
  p_name text default null,
  p_default_amount bigint default null,
  p_grace_days int default null,
  p_start_date date default null,
  p_status plan_status default null,
  p_end_date date default null
)
returns plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_new_start date;
  v_new_end date;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can change a contribution plan';
  end if;

  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'Give the plan a name';
  end if;

  if p_default_amount is not null and v_plan.kind <> 'open' and p_default_amount <= 0 then
    raise exception 'Set how much each member contributes';
  end if;

  v_new_start := coalesce(p_start_date, v_plan.start_date);
  v_new_end := coalesce(p_end_date, v_plan.end_date);

  if v_new_start > v_plan.start_date then
    raise exception
      'The start date can only be moved earlier. Moving it later would remove periods that may already hold payments.';
  end if;

  if v_new_end is not null and v_new_end < v_new_start then
    raise exception 'The closing date cannot be before the start date';
  end if;

  update plans
  set
    name           = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
    default_amount = case
                       when kind = 'open' then null
                       else coalesce(p_default_amount, default_amount)
                     end,
    grace_days     = coalesce(greatest(p_grace_days, 0), grace_days),
    start_date     = v_new_start,
    end_date       = v_new_end,
    status         = coalesce(p_status, status)
  where id = p_plan_id
  returning * into v_plan;

  -- A one-off's deadline lives on its single cycle; keep it in step.
  if v_plan.frequency = 'once' and v_plan.end_date is not null then
    update cycles
    set period_end = v_plan.end_date,
        due_date   = v_plan.end_date,
        status     = case
                       when v_plan.end_date < current_date then 'closed'::cycle_status
                       else 'open'::cycle_status
                     end
    where plan_id = p_plan_id;
  end if;

  perform generate_due_cycles(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function update_plan(uuid, text, bigint, int, date, plan_status, date) to authenticated;
