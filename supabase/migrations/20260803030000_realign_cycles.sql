-- Re-align collection periods when a plan's schedule shifts.
--
-- prune_misaligned_cycles deletes stranded periods, but deliberately refuses to
-- touch one holding a payment. That left the duplicate-month problem unsolved
-- for exactly the case that matters: a period someone had already paid into.
--
-- Re-aligning is better than deleting. A stranded period is moved onto the
-- nearest schedule slot, keeping its obligations and payments intact. Only when
-- that slot is already occupied is the duplicate removed — and then its money is
-- released back to credit rather than destroyed, so apply_credit re-settles it
-- against the surviving periods.

create function realign_cycles(p_plan_id uuid)
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
  v_target date;
  v_end date;
  v_changed int := 0;
  v_members uuid[] := array[]::uuid[];
  v_batch uuid[];
  r_stranded record;
  v_member uuid;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  -- The schedule this plan should have.
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

  if array_length(v_valid, 1) is null then
    return 0;
  end if;

  for r_stranded in
    select *
    from cycles
    where plan_id = p_plan_id
      and not (period_start = any(v_valid))
    order by period_start
  loop
    -- The slot this period belongs in: the latest scheduled start at or before
    -- it, falling back to the earliest if it predates the whole schedule.
    select max(d) into v_target from unnest(v_valid) d where d <= r_stranded.period_start;
    if v_target is null then
      select min(d) into v_target from unnest(v_valid) d;
    end if;

    if v_plan.frequency = 'once' then
      v_end := coalesce(v_plan.end_date, v_target);
    else
      v_end := cycle_end_for(v_plan.frequency, v_target);
    end if;

    if not exists (
      select 1 from cycles where plan_id = p_plan_id and period_start = v_target
    ) then
      -- The slot is free: move the period onto it, payments and all.
      update cycles
      set period_start = v_target,
          period_end   = v_end,
          due_date     = v_end,
          label        = cycle_label_for(v_plan.frequency, v_target),
          status       = case
                           when v_end < current_date then 'closed'::cycle_status
                           else 'open'::cycle_status
                         end
      where id = r_stranded.id;
    else
      -- The slot is taken. Release this period's money back to credit, keeping
      -- whatever the payment was originally designated to, then drop it.
      select coalesce(array_agg(distinct p.member_id), array[]::uuid[])
        into v_batch
      from allocations a
      join payments p on p.id = a.payment_id
      where a.obligation_id in (select id from obligations where cycle_id = r_stranded.id);

      v_members := v_members || v_batch;

      update allocations a
      set obligation_id = null,
          plan_id = p.designated_plan_id
      from payments p
      where p.id = a.payment_id
        and a.obligation_id in (select id from obligations where cycle_id = r_stranded.id);

      -- Obligations cascade with the cycle.
      delete from cycles where id = r_stranded.id;
    end if;

    v_changed := v_changed + 1;
  end loop;

  -- Re-settle anything that was released.
  foreach v_member in array v_members loop
    perform apply_credit(v_member);
  end loop;

  return v_changed;
end;
$$;

revoke execute on function realign_cycles(uuid) from anon, authenticated;

/*
 * Order matters: re-align first, so a stranded period claims its correct slot
 * before generate_due_cycles creates a fresh empty one there. Pruning last
 * clears anything left over that holds no money.
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

  perform realign_cycles(p_plan_id);
  perform generate_due_cycles(p_plan_id);
  perform prune_misaligned_cycles(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function update_plan(uuid, text, bigint, int, date, plan_status, date) to authenticated;

-- Repair any plan already carrying a stranded period that holds money.
do $$
declare
  r record;
  v_moved int;
begin
  for r in select id, name from plans loop
    v_moved := realign_cycles(r.id);
    if v_moved > 0 then
      raise notice 'Re-aligned % period(s) on plan "%"', v_moved, r.name;
    end if;
    perform prune_misaligned_cycles(r.id);
  end loop;
end;
$$;
