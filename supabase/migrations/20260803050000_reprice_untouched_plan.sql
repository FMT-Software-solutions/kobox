-- A contribution nobody has paid into is still being set up.
--
-- Until then, changing the amount re-prices every period it has issued. Once a
-- single payment exists the books are live, and issued periods keep the amount
-- members were told — a rate rise must never reach backwards.
--
-- The switch is plan_has_money(): one rule, easy to explain to a treasurer.

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
  v_untouched boolean;
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

  -- Decided before anything changes.
  v_untouched := not plan_has_money(p_plan_id);

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

  -- Nothing has been paid, so periods already issued can safely take the new
  -- amount. Per-member overrides still win, and exempt members stay exempt.
  if v_untouched and p_default_amount is not null and v_plan.kind <> 'open' then
    update obligations o
    set amount_due = coalesce(
      (
        select ov.amount from plan_member_overrides ov
        where ov.plan_id = p_plan_id and ov.member_id = o.member_id
      ),
      v_plan.default_amount
    )
    where o.cycle_id in (select id from cycles where plan_id = p_plan_id)
      and not exists (
        select 1 from plan_member_overrides ov
        where ov.plan_id = p_plan_id
          and ov.member_id = o.member_id
          and ov.amount is null
      );
  end if;

  perform realign_cycles(p_plan_id);
  perform generate_due_cycles(p_plan_id);
  perform prune_misaligned_cycles(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function update_plan(uuid, text, bigint, int, date, plan_status, date) to authenticated;
