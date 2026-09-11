-- Advance payments, plan editing, and per-plan totals.

/**
 * Applies a member's held credit to any obligation they now owe.
 *
 * Someone paying a year of dues up front leaves a large unallocated allocation.
 * Without this, every new cycle would show them as owing while their money sits
 * in credit — the single most confusing thing a contributions app can do.
 *
 * Credit is spent oldest-payment-first, against oldest obligation first.
 */
create function apply_credit(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_credit record;
  r_ob record;
  v_left bigint;
  v_take bigint;
begin
  for r_credit in
    select a.id, a.amount, a.payment_id
    from allocations a
    join payments p on p.id = a.payment_id
    where a.obligation_id is null
      and a.amount > 0
      and p.member_id = p_member_id
      and p.status = 'confirmed'
    order by p.paid_at, a.created_at
  loop
    v_left := r_credit.amount;

    for r_ob in
      select b.obligation_id, b.balance, c.plan_id
      from obligation_balances b
      join cycles c on c.id = b.cycle_id
      where b.member_id = p_member_id
        and b.balance > 0
      order by c.due_date, c.period_start
    loop
      exit when v_left <= 0;

      v_take := least(v_left, r_ob.balance);

      insert into allocations (payment_id, obligation_id, plan_id, amount)
      values (r_credit.payment_id, r_ob.obligation_id, r_ob.plan_id, v_take);

      v_left := v_left - v_take;
    end loop;

    -- Shrink the credit row by whatever was spent; drop it when fully consumed.
    -- Allocations still sum to exactly the payment amount either way.
    if v_left <= 0 then
      delete from allocations where id = r_credit.id;
    elsif v_left < r_credit.amount then
      update allocations set amount = v_left where id = r_credit.id;
    end if;
  end loop;
end;
$$;

revoke execute on function apply_credit(uuid) from anon, authenticated;

-- generate_cycle now settles any held credit against the obligations it issues.
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
  v_end := cycle_end_for(v_plan.frequency, v_start);

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

    -- Anyone holding credit should have it applied to what just became due.
    for r_member in
      select distinct p.member_id
      from allocations a
      join payments p on p.id = a.payment_id
      where a.obligation_id is null
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

/**
 * Edits a plan.
 *
 * Changing the amount affects FUTURE cycles only. Rewriting what members were
 * already told they owed would silently alter history and could make a settled
 * cycle unpaid again.
 *
 * The start date may only move EARLIER, which backfills the missing periods.
 * Moving it later would have to delete cycles that may already hold payments,
 * so it is refused rather than silently destroying records.
 */
create function update_plan(
  p_plan_id uuid,
  p_name text default null,
  p_default_amount bigint default null,
  p_grace_days int default null,
  p_start_date date default null,
  p_status plan_status default null
)
returns plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_new_start date;
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

  if v_new_start > v_plan.start_date then
    raise exception
      'The start date can only be moved earlier. Moving it later would remove periods that may already hold payments.';
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
    status         = coalesce(p_status, status)
  where id = p_plan_id
  returning * into v_plan;

  -- Backfill anything the earlier start date now implies.
  perform generate_due_cycles(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function update_plan(uuid, text, bigint, int, date, plan_status) to authenticated;

-- Totals per plan, for the plan detail screen.
create view plan_summaries
with (security_invoker = true)
as
select
  p.id                                     as plan_id,
  p.group_id,
  count(distinct c.id)::int                as cycle_count,
  coalesce(sum(b.amount_due), 0)::bigint   as total_expected,
  coalesce(sum(b.amount_paid), 0)::bigint  as total_collected
from plans p
left join cycles c on c.plan_id = p.id
left join obligation_balances b on b.cycle_id = c.id
group by p.id;

-- Surface held credit alongside what each member owes.
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
    and a.amount > 0
    and p.status = 'confirmed'
  group by p.member_id
) cr on cr.member_id = m.id;
