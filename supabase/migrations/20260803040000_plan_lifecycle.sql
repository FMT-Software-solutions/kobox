-- Editing and deleting contributions, gated on whether money has moved.
--
-- The rule throughout: a contribution is freely editable until someone has paid
-- into it. After that, periods and records are protected, and the way forward is
-- to END the contribution rather than erase it.

/*
 * group_summaries counted a reversal twice.
 *
 * reverse_payment marks the original 'reversed' and inserts a negative entry.
 * The old view summed only 'confirmed' rows, so the original dropped out AND the
 * negative was added — a reversed ₵40 payment moved the group balance by -₵40
 * instead of back to zero.
 *
 * Both rows must be counted: the original plus its negative offset nets to zero.
 */
create or replace view group_summaries
with (security_invoker = true)
as
select
  g.id as group_id,
  coalesce((
    select sum(p.amount) from payments p
    where p.group_id = g.id and p.status in ('confirmed', 'reversed')
  ), 0)::bigint as total_collected,
  coalesce((
    select sum(e.amount) from expenses e
    where e.group_id = g.id and e.status = 'approved'
  ), 0)::bigint as total_expenses,
  coalesce((
    select sum(p.amount) from payments p
    where p.group_id = g.id and p.status in ('confirmed', 'reversed')
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

/** True when any money at all is attached to this contribution. */
create function plan_has_money(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from cycles c
      join obligations o on o.cycle_id = c.id
      join allocations a on a.obligation_id = o.id
      where c.plan_id = p_plan_id
    )
    or exists (
      select 1 from payments
      where designated_plan_id = p_plan_id
        and status in ('pending', 'confirmed', 'reversed')
    );
$$;

/*
 * Moving the start date later is now allowed, but only while the periods being
 * dropped are completely empty. The moment one holds a payment the move is
 * refused and the offending period is named, so the treasurer knows exactly what
 * is in the way rather than being told "no".
 */
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
  v_blocking text;
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

  if v_new_end is not null and v_new_end < v_new_start then
    raise exception 'The closing date cannot be before the start date';
  end if;

  if v_new_start > v_plan.start_date then
    select c.label
      into v_blocking
    from cycles c
    join obligations o on o.cycle_id = c.id
    join allocations a on a.obligation_id = o.id
    where c.plan_id = p_plan_id
      and c.period_start < v_new_start
    order by c.period_start
    limit 1;

    if v_blocking is not null then
      raise exception
        '% already has payments recorded, so the start date cannot move past it. Reverse those payments first, or create a new contribution.',
        v_blocking;
    end if;
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

  -- Drop the now-out-of-range periods. Verified empty above.
  delete from cycles
  where plan_id = p_plan_id
    and period_start < v_plan.start_date;

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

  perform realign_cycles(p_plan_id);
  perform generate_due_cycles(p_plan_id);
  perform prune_misaligned_cycles(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function update_plan(uuid, text, bigint, int, date, plan_status, date) to authenticated;

/*
 * Deleting a contribution.
 *
 * Restricted to admins and owners, and refused outright once any payment is
 * attached. Deleting then would strip those payments of what they were for,
 * leaving money in the books that nobody can explain. Ending the contribution
 * keeps every record and simply stops new periods opening.
 */
create function delete_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can delete a contribution';
  end if;

  if plan_has_money(p_plan_id) then
    raise exception
      'This contribution has payments recorded against it and cannot be deleted. End it instead — the records stay and no new periods open.';
  end if;

  delete from plans where id = p_plan_id;
end;
$$;

grant execute on function delete_plan(uuid) to authenticated;
