-- Susu (rotating savings) end to end.
--
-- Everyone contributes the same amount each period, and one member collects the
-- whole pot. Over N periods everyone collects once.
--
-- Design decisions, and the reasoning:
--
-- * A slot holds a POSITION and a MEMBER; its cycle is attached later, as each
--   period opens. Creating all N periods up front would make members "owe"
--   next year's contributions today and wreck every arrears figure.
--
-- * The rotation defines the plan's length. Assigning it sets the plan's end
--   date to the Nth period, so periods stop generating once everyone has had a
--   turn rather than running on forever.
--
-- * The recipient still contributes in the period they collect. That is how susu
--   works — they pay in and take the pot including their own money.
--
-- * A payout is recorded as an APPROVED EXPENSE, reusing the approval, voiding
--   and balance machinery rather than inventing a parallel one.
--
-- * Netting arrears is supported explicitly: the pot leaves as an expense at
--   full value, and the member's unpaid contribution is recorded as a payment
--   in. Cash nets correctly and neither side of the ledger is fudged.
--
-- * One round per plan. When every position has collected, the susu is complete.
--   Groups normally re-draw the order for a new round, so a fresh contribution
--   is the honest representation of that.

-- A slot exists before its period does.
alter table rotation_slots
  alter column cycle_id drop not null,
  alter column expected_payout drop not null;

alter table rotation_slots
  add column payout_expense_id uuid references expenses (id) on delete set null,
  add column note text;

-- One member may hold only one position per plan.
create unique index rotation_slots_plan_member_idx on rotation_slots (plan_id, member_id);

/** Number of periods a rotation of `n` members needs, ending on that period. */
create function rotation_end_date(p_plan_id uuid, p_positions int)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_cursor date;
  v_next date;
  i int;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null or p_positions < 1 then
    return null;
  end if;

  v_cursor := v_plan.start_date;
  for i in 2..greatest(p_positions, 1) loop
    v_next := next_cycle_start(v_plan.frequency, v_cursor);
    exit when v_next is null;
    v_cursor := v_next;
  end loop;

  return cycle_end_for(v_plan.frequency, v_cursor);
end;
$$;

/**
 * Sets the running order. The array order IS the rotation order — position 1
 * collects first.
 *
 * Only possible before anyone has collected: re-drawing the order after a payout
 * would change who has already benefited relative to who has not.
 */
create function assign_rotation(p_plan_id uuid, p_member_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_count int;
  v_member uuid;
  i int := 0;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can set the rotation order';
  end if;

  if v_plan.kind <> 'rotating' then
    raise exception 'Only a susu contribution has a rotation order';
  end if;

  v_count := coalesce(array_length(p_member_ids, 1), 0);
  if v_count < 2 then
    raise exception 'A susu needs at least two members in the rotation';
  end if;

  if (select count(distinct m) from unnest(p_member_ids) m) <> v_count then
    raise exception 'A member can only hold one position in the rotation';
  end if;

  if exists (
    select 1 from rotation_slots
    where plan_id = p_plan_id and paid_out_at is not null
  ) then
    raise exception
      'Someone has already collected, so the order can no longer be redrawn. Replace an individual position instead.';
  end if;

  if exists (
    select 1
    from unnest(p_member_ids) m
    where not exists (
      select 1 from group_members gm
      where gm.id = m and gm.group_id = v_plan.group_id and gm.status = 'active'
    )
  ) then
    raise exception 'Everyone in the rotation must be an active member of the group';
  end if;

  delete from rotation_slots where plan_id = p_plan_id;

  foreach v_member in array p_member_ids loop
    i := i + 1;
    insert into rotation_slots (plan_id, cycle_id, member_id, position, expected_payout)
    values (p_plan_id, null, v_member, i, null);
  end loop;

  -- The rotation decides how long the susu runs.
  update plans set end_date = rotation_end_date(p_plan_id, v_count) where id = p_plan_id;

  perform link_rotation_cycles(p_plan_id);

  return v_count;
end;
$$;

/**
 * Attaches open periods to rotation positions in order.
 *
 * Called whenever a period opens, so the earliest unattached period takes the
 * lowest unattached position. Idempotent.
 */
create function link_rotation_cycles(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_cycle record;
  v_slot rotation_slots;
begin
  for r_cycle in
    select c.id
    from cycles c
    where c.plan_id = p_plan_id
      and not exists (select 1 from rotation_slots s where s.cycle_id = c.id)
    order by c.period_start
  loop
    select * into v_slot
    from rotation_slots
    where plan_id = p_plan_id and cycle_id is null
    order by position
    limit 1;

    exit when v_slot.id is null;

    update rotation_slots set cycle_id = r_cycle.id where id = v_slot.id;
  end loop;
end;
$$;

revoke execute on function link_rotation_cycles(uuid) from anon, authenticated;

/** Adds a latecomer at the end of the running order and extends the susu. */
create function append_to_rotation(p_plan_id uuid, p_member_id uuid)
returns rotation_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_next_position int;
  v_slot rotation_slots;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can change the rotation';
  end if;

  if v_plan.kind <> 'rotating' then
    raise exception 'Only a susu contribution has a rotation order';
  end if;

  if not exists (
    select 1 from group_members
    where id = p_member_id and group_id = v_plan.group_id and status = 'active'
  ) then
    raise exception 'That member is not active in this group';
  end if;

  if exists (select 1 from rotation_slots where plan_id = p_plan_id and member_id = p_member_id) then
    raise exception 'That member already has a position in this rotation';
  end if;

  select coalesce(max(position), 0) + 1 into v_next_position
  from rotation_slots where plan_id = p_plan_id;

  insert into rotation_slots (plan_id, cycle_id, member_id, position, expected_payout)
  values (p_plan_id, null, p_member_id, v_next_position, null)
  returning * into v_slot;

  update plans set end_date = rotation_end_date(p_plan_id, v_next_position) where id = p_plan_id;

  perform generate_due_cycles(p_plan_id);
  perform link_rotation_cycles(p_plan_id);

  return v_slot;
end;
$$;

/**
 * Hands a position to a different member — for when someone leaves before their
 * turn. Refused once that position has collected, since the money is gone.
 */
create function replace_rotation_member(p_slot_id uuid, p_member_id uuid)
returns rotation_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot rotation_slots;
  v_plan plans;
begin
  select * into v_slot from rotation_slots where id = p_slot_id;
  if v_slot.id is null then
    raise exception 'Rotation position not found';
  end if;

  select * into v_plan from plans where id = v_slot.plan_id;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can change the rotation';
  end if;

  if v_slot.paid_out_at is not null then
    raise exception 'That position has already collected and cannot be reassigned';
  end if;

  if not exists (
    select 1 from group_members
    where id = p_member_id and group_id = v_plan.group_id and status = 'active'
  ) then
    raise exception 'That member is not active in this group';
  end if;

  if exists (
    select 1 from rotation_slots
    where plan_id = v_slot.plan_id and member_id = p_member_id and id <> p_slot_id
  ) then
    raise exception 'That member already holds another position in this rotation';
  end if;

  update rotation_slots set member_id = p_member_id where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

/**
 * Records that a member has collected the pot.
 *
 * `p_settle_arrears` handles the everyday case where the recipient still owes
 * their own contribution: the pot leaves at full value as an expense, and their
 * unpaid share is recorded as a payment in. Cash nets to the amount actually
 * handed over, and neither side of the ledger is fudged.
 */
create function record_payout(
  p_slot_id uuid,
  p_amount bigint,
  p_settle_arrears boolean default false,
  p_note text default null
)
returns rotation_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot rotation_slots;
  v_plan plans;
  v_cycle cycles;
  v_member group_members;
  v_arrears bigint := 0;
  v_settled bigint := 0;
  v_expense expenses;
begin
  select * into v_slot from rotation_slots where id = p_slot_id;
  if v_slot.id is null then
    raise exception 'Rotation position not found';
  end if;

  select * into v_plan from plans where id = v_slot.plan_id;

  if not has_group_role(v_plan.group_id, 'treasurer') then
    raise exception 'Only a treasurer or above can record a payout';
  end if;

  if v_slot.paid_out_at is not null then
    raise exception 'That position has already collected';
  end if;

  if v_slot.cycle_id is null then
    raise exception 'That turn has not come round yet';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;

  select * into v_cycle from cycles where id = v_slot.cycle_id;
  select * into v_member from group_members where id = v_slot.member_id;

  -- Settle the recipient's own unpaid contributions to this susu first.
  if p_settle_arrears then
    select coalesce(sum(b.balance), 0)
      into v_arrears
    from obligation_balances b
    join cycles c on c.id = b.cycle_id
    where c.plan_id = v_slot.plan_id
      and b.member_id = v_slot.member_id
      and b.balance > 0;

    v_settled := least(v_arrears, p_amount);

    if v_settled > 0 then
      perform record_payment(
        v_plan.group_id,
        v_slot.member_id,
        v_settled,
        'other'::payment_method,
        now(),
        null,
        'Deducted from susu payout',
        v_slot.plan_id
      );
    end if;
  end if;

  -- The whole pot leaves the group, whether or not part of it was netted off.
  v_expense := record_expense(
    v_plan.group_id,
    'Susu payout — ' || v_member.full_name || ' (' || v_cycle.label || ')',
    p_amount,
    'susu_payout',
    now(),
    nullif(trim(coalesce(p_note, '')), '')
  );

  update rotation_slots
  set paid_out_amount = p_amount,
      paid_out_at = now(),
      payout_expense_id = v_expense.id,
      note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

/** Undoes a payout: voids the expense and frees the position to collect again. */
create function reverse_payout(p_slot_id uuid, p_reason text)
returns rotation_slots
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot rotation_slots;
  v_plan plans;
begin
  select * into v_slot from rotation_slots where id = p_slot_id;
  if v_slot.id is null then
    raise exception 'Rotation position not found';
  end if;

  select * into v_plan from plans where id = v_slot.plan_id;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can reverse a payout';
  end if;

  if v_slot.paid_out_at is null then
    raise exception 'That position has not collected yet';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason';
  end if;

  if v_slot.payout_expense_id is not null then
    perform void_expense(v_slot.payout_expense_id, trim(p_reason));
  end if;

  update rotation_slots
  set paid_out_amount = null,
      paid_out_at = null,
      payout_expense_id = null
  where id = p_slot_id
  returning * into v_slot;

  return v_slot;
end;
$$;

-- Periods opening must claim their rotation position.
create or replace function generate_due_cycles(p_plan_id uuid, p_up_to date default current_date)
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
    exit when v_next is null;
    exit when v_next <= v_start;
    v_start := v_next;
  end loop;

  if v_plan.kind = 'rotating' then
    perform link_rotation_cycles(p_plan_id);
  end if;

  return v_count;
end;
$$;

grant execute on function assign_rotation(uuid, uuid[]) to authenticated;
grant execute on function append_to_rotation(uuid, uuid) to authenticated;
grant execute on function replace_rotation_member(uuid, uuid) to authenticated;
grant execute on function record_payout(uuid, bigint, boolean, text) to authenticated;
grant execute on function reverse_payout(uuid, text) to authenticated;

/**
 * Everything a rotation screen needs: who is in which position, when their turn
 * falls, what the pot is worth, how much has actually been collected, and
 * whether they have taken it.
 */
create view rotation_status
with (security_invoker = true)
as
select
  s.id                                        as slot_id,
  s.plan_id,
  p.group_id,
  s.position,
  s.member_id,
  m.full_name                                 as member_name,
  m.status                                    as member_status,
  s.cycle_id,
  c.label                                     as cycle_label,
  c.due_date,
  -- The pot is what the whole group owes for that period.
  coalesce((
    select sum(o.amount_due) from obligations o where o.cycle_id = s.cycle_id
  ), 0)::bigint                               as expected_pot,
  coalesce((
    select sum(b.amount_paid) from obligation_balances b where b.cycle_id = s.cycle_id
  ), 0)::bigint                               as collected_so_far,
  s.paid_out_amount,
  s.paid_out_at,
  s.note,
  case
    when s.paid_out_at is not null then 'paid'
    when s.cycle_id is null        then 'upcoming'
    else 'due'
  end                                         as slot_status
from rotation_slots s
join plans p on p.id = s.plan_id
join group_members m on m.id = s.member_id
left join cycles c on c.id = s.cycle_id;

-- RLS on rotation_slots already restricts to group members; the view inherits it.
