-- Who a contribution actually bills.
--
-- Until now every plan except 'open' issued an obligation to every active
-- member of the group. For a susu that is wrong: a rotation of five inside a
-- group of twenty billed all twenty. The arrears were fictional, and because
-- rotation_status derives the pot from the obligations issued for the period,
-- the pot was inflated to match — so record_payout was being offered a figure
-- with no money behind it.
--
-- The rule, decided with the user: a susu is for the people in the rotation.
-- Membership is explicit — you are in it because someone gave you a position,
-- not because you happen to be in the group. Before the order is drawn a susu
-- therefore bills nobody, and assigning the order is what starts it collecting.
--
-- Three copies of the amount-resolution rule had drifted apart along the way:
-- generate_cycle honoured per-member overrides, add_member ignored them
-- entirely (so adding a member re-billed the default to someone the group had
-- exempted), and update_plan carried a third variant. This replaces the first
-- two with one function that every caller asks.

/**
 * What `p_member_id` owes for one period of `p_plan_id`, or NULL if they are
 * not billed by this plan at all.
 *
 * Precedence: not in the audience → exempt → per-member override → plan default.
 *
 * NULL is deliberately the "do not bill" answer for all three of the ways that
 * can happen — open giving, an exemption, and a susu you hold no position in —
 * so callers have one condition to test rather than three.
 */
create function plan_obligation_amount(p_plan_id uuid, p_member_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_override plan_member_overrides;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    return null;
  end if;

  -- Open giving issues no obligations: members give what they wish.
  if v_plan.kind = 'open' then
    return null;
  end if;

  -- A susu bills its rotation and nobody else. Before the order is drawn no
  -- position exists, so a susu that is still being set up bills no one.
  if v_plan.kind = 'rotating' and not exists (
    select 1 from rotation_slots s
    where s.plan_id = p_plan_id and s.member_id = p_member_id
  ) then
    return null;
  end if;

  select * into v_override
  from plan_member_overrides
  where plan_id = p_plan_id and member_id = p_member_id;

  -- An override row that exists with a NULL amount means exempt. That is how a
  -- group excuses a bereaved or elderly member without deleting them and
  -- without corrupting the collection rate.
  if v_override.id is not null then
    return v_override.amount;
  end if;

  return v_plan.default_amount;
end;
$$;

-- Internal: the answer depends on rows the caller may not be able to see, so it
-- is only ever asked on behalf of an already-authorised RPC.
revoke execute on function plan_obligation_amount(uuid, uuid) from anon, authenticated;

/**
 * Brings a plan's issued obligations back in line with who it should be billing.
 *
 * Needed because the audience can change after periods have already opened:
 * create_plan opens the first period before assign_rotation can possibly have
 * run, and positions are appended and handed over later.
 *
 * It only ever ADDS or WAIVES — it never re-prices, so the promise that an
 * issued obligation keeps the amount the member was told still holds.
 *
 * An obligation carrying confirmed money is left alone. Waiving it would drop
 * it out of obligation_balances and take the member's payment down with it,
 * making real money disappear from the books. Someone who has paid into a
 * period stays on it; the treasurer settles that by hand.
 */
create function reissue_plan_obligations(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_changed int := 0;
  v_rows int;
  -- Marks the rows this function waived, so a later run can undo its own work
  -- without ever reviving a waiver a treasurer entered deliberately.
  c_auto_reason constant text := 'Not part of this contribution';
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  -- 1. Issue to everyone in the audience who has not been billed yet.
  insert into obligations (cycle_id, member_id, amount_due)
  select c.id, m.id, plan_obligation_amount(p_plan_id, m.id)
  from cycles c
  cross join group_members m
  where c.plan_id = p_plan_id
    and m.group_id = v_plan.group_id
    and m.status = 'active'
    and plan_obligation_amount(p_plan_id, m.id) is not null
  on conflict (cycle_id, member_id) do nothing;

  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  -- 2. Someone who is back in the audience owes again.
  update obligations o
  set waived = false, waived_reason = null
  from cycles c
  where c.id = o.cycle_id
    and c.plan_id = p_plan_id
    and o.waived
    and o.waived_reason = c_auto_reason
    and plan_obligation_amount(p_plan_id, o.member_id) is not null;

  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  -- 3. Someone outside the audience stops owing — unless they have paid.
  update obligations o
  set waived = true, waived_reason = c_auto_reason
  from cycles c
  where c.id = o.cycle_id
    and c.plan_id = p_plan_id
    and not o.waived
    and plan_obligation_amount(p_plan_id, o.member_id) is null
    and not exists (
      select 1
      from allocations a
      join payments p on p.id = a.payment_id
      where a.obligation_id = o.id and p.status = 'confirmed'
    );

  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  return v_changed;
end;
$$;

revoke execute on function reissue_plan_obligations(uuid) from anon, authenticated;

-- Opening a period now asks one question per member instead of inlining the rule.
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

  insert into obligations (cycle_id, member_id, amount_due)
  select v_cycle.id, m.id, plan_obligation_amount(p_plan_id, m.id)
  from group_members m
  where m.group_id = v_plan.group_id
    and m.status = 'active'
    and plan_obligation_amount(p_plan_id, m.id) is not null;

  -- A new period is the moment held money finally has something to settle.
  if v_plan.kind <> 'open' then
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

-- add_member had its own copy of the rule and it had fallen behind: it billed
-- p.default_amount flat, so a member the group had exempted was billed the
-- default the moment they were added, and a newcomer was billed into susus
-- they held no position in.
create or replace function add_member(
  p_group_id uuid,
  p_full_name text,
  p_phone text default null,
  p_role member_role default 'member',
  p_include_past_periods boolean default false
)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can add members';
  end if;

  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Enter the member''s name';
  end if;

  -- Only an owner may mint another owner.
  if p_role = 'owner' and not has_group_role(p_group_id, 'owner') then
    raise exception 'Only the owner can appoint another owner';
  end if;

  insert into group_members (group_id, user_id, full_name, phone, role, status)
  values (p_group_id, null, trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), p_role, 'active')
  returning * into v_member;

  insert into obligations (cycle_id, member_id, amount_due)
  select c.id, v_member.id, plan_obligation_amount(p.id, v_member.id)
  from cycles c
  join plans p on p.id = c.plan_id
  where p.group_id = p_group_id
    and p.status = 'active'
    and plan_obligation_amount(p.id, v_member.id) is not null
    and (p_include_past_periods or c.status = 'open')
  on conflict (cycle_id, member_id) do nothing;

  return v_member;
end;
$$;

-- Drawing the order is what makes a susu start collecting, so the periods that
-- opened before it must now be issued.
create or replace function assign_rotation(p_plan_id uuid, p_member_ids uuid[])
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
  perform reissue_plan_obligations(p_plan_id);

  return v_count;
end;
$$;

-- Taking a position starts you contributing.
create or replace function append_to_rotation(p_plan_id uuid, p_member_id uuid)
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
  perform reissue_plan_obligations(p_plan_id);

  return v_slot;
end;
$$;

-- Handing a position over moves the contributing with it.
create or replace function replace_rotation_member(p_slot_id uuid, p_member_id uuid)
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

  perform reissue_plan_obligations(v_slot.plan_id);

  return v_slot;
end;
$$;

-- The pot is what the rotation owes for that period. Summing obligations
-- directly counted waived rows, so a member taken out of the susu still
-- inflated it; obligation_balances already excludes them.
create or replace view rotation_status
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
  coalesce((
    select sum(b.amount_due) from obligation_balances b where b.cycle_id = s.cycle_id
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

-- Same guard as 20260803020000, extended to the functions this migration
-- touches. `create or replace` silently adds an overload when an argument list
-- changes, and PostgREST then refuses to call either one.
do $$
declare
  r record;
begin
  for r in
    select p.proname, count(*) as overloads
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_plan', 'update_plan', 'add_member', 'record_payment',
        'create_group', 'join_group', 'generate_cycle', 'generate_due_cycles',
        'apply_credit', 'allocate_payment', 'confirm_payment', 'reverse_payment',
        'assign_rotation', 'append_to_rotation', 'replace_rotation_member',
        'record_payout', 'reverse_payout', 'plan_obligation_amount',
        'reissue_plan_obligations'
      )
    group by p.proname
    having count(*) > 1
  loop
    raise exception
      'Function %() still has % overloads — PostgREST cannot choose between them',
      r.proname, r.overloads;
  end loop;
end;
$$;
