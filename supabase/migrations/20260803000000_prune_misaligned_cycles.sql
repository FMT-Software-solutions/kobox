-- Remove collection periods that no longer sit on their plan's schedule.
--
-- Periods are keyed by their start date, so moving a plan's start date changes
-- the whole alignment grid. A plan created on 2 August produced a 2 Aug–1 Sep
-- period; pulling its start back to 1 June then generated 1 Jun, 1 Jul, 1 Aug —
-- and left the original 2 Aug period stranded. The member saw "August 2026"
-- twice and was billed for both.
--
-- Stranded periods are only removed when no money is attached to them. A period
-- that has taken a payment is never deleted: that would destroy a financial
-- record to tidy up a schedule.

create function prune_misaligned_cycles(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_valid date[] := array[]::date[];
  v_cursor date;
  v_next date;
  v_count int := 0;
  v_deleted int := 0;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  -- Rebuild the schedule the plan *should* have.
  v_cursor := v_plan.start_date;
  loop
    exit when v_cursor > current_date;
    exit when v_plan.end_date is not null and v_cursor > v_plan.end_date;

    v_valid := v_valid || v_cursor;
    v_count := v_count + 1;
    exit when v_count >= 520;

    v_next := next_cycle_start(v_plan.frequency, v_cursor);
    exit when v_next is null;
    exit when v_next <= v_cursor;
    v_cursor := v_next;
  end loop;

  delete from cycles c
  where c.plan_id = p_plan_id
    and not (c.period_start = any(v_valid))
    and not exists (
      select 1
      from obligations o
      join allocations a on a.obligation_id = o.id
      where o.cycle_id = c.id
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function prune_misaligned_cycles(uuid) from anon, authenticated;

-- update_plan tidies up after itself whenever the schedule shifts.
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
  perform prune_misaligned_cycles(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function update_plan(uuid, text, bigint, int, date, plan_status, date) to authenticated;

-- One-time repair of plans already affected. Only removes stranded periods with
-- no money attached; anything holding a payment is left alone.
do $$
declare
  r record;
  v_removed int;
  v_total int := 0;
begin
  for r in select id, name from plans loop
    v_removed := prune_misaligned_cycles(r.id);
    if v_removed > 0 then
      raise notice 'Removed % stranded period(s) from plan "%"', v_removed, r.name;
      v_total := v_total + v_removed;
    end if;
  end loop;

  raise notice 'Pruned % stranded period(s) in total', v_total;
end;
$$;
