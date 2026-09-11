-- Designated money must still settle its own contribution's future periods.
--
-- apply_credit previously ignored every allocation that carried a plan, to stop
-- money given to one contribution leaking into another. That was too strict: it
-- also froze money designated to a plan whose periods had not opened yet.
--
-- Someone paying ₵40 towards Monthly Dues before June/July/August existed ended
-- up with ₵40 sitting inert while all three months showed as fully owing.
--
-- The correct rule: designated money settles obligations OF THAT PLAN ONLY.
-- General money settles anything. Neither ever crosses into another contribution.

create or replace function apply_credit(p_member_id uuid)
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
    select a.id, a.amount, a.payment_id, a.plan_id
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
        -- General credit settles anything; designated credit only its own plan.
        and (r_credit.plan_id is null or c.plan_id = r_credit.plan_id)
      order by c.due_date, c.period_start
    loop
      exit when v_left <= 0;

      v_take := least(v_left, r_ob.balance);

      insert into allocations (payment_id, obligation_id, plan_id, amount)
      values (r_credit.payment_id, r_ob.obligation_id, r_ob.plan_id, v_take);

      v_left := v_left - v_take;
    end loop;

    if v_left <= 0 then
      delete from allocations where id = r_credit.id;
    elsif v_left < r_credit.amount then
      update allocations set amount = v_left where id = r_credit.id;
    end if;
  end loop;
end;
$$;

-- New periods must also wake up designated money, not just general credit.
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

-- Settle any money already stranded by the old behaviour.
do $$
declare
  r record;
begin
  for r in
    select distinct p.member_id
    from allocations a
    join payments p on p.id = a.payment_id
    where a.obligation_id is null
      and a.amount > 0
      and p.status = 'confirmed'
  loop
    perform apply_credit(r.member_id);
  end loop;
end;
$$;
