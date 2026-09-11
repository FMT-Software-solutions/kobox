-- Different tags paying different amounts on the same contribution.
--
-- "Executives pay ₵100, everyone else pays ₵50" as one contribution rather than
-- two. Two contributions would work, but then the group has two sets of totals,
-- two collection rates and two things to explain — and a member who moves
-- between the two has to be moved by hand in both.
--
-- Resolution order, most specific first:
--
--   1. not in the audience              → not billed at all
--   2. per-member override              → that amount (NULL means exempt)
--   3. first matching tag amount by rank → that amount
--   4. the plan default                 → that amount
--
-- Overlapping tags are settled by an explicit `rank`, lowest first. Someone who
-- is both an Executive and a Youth member is billed once, at whichever of those
-- the group ranked higher. Guessing — cheapest, dearest, most recent — would be
-- unexplainable to a treasurer; a number they set is not.
--
-- This is step 4 of that chain, so it changes what people owe. It is therefore
-- bound by the same rule as changing the plan's default amount: re-price freely
-- while nobody has paid in, and never afterwards. plan_has_money() is the switch,
-- exactly as update_plan uses it.

create table plan_tag_amounts (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references plans (id) on delete cascade,
  tag_id     uuid not null references tags (id) on delete cascade,
  amount     bigint not null check (amount >= 0),
  -- Lowest rank wins when a member carries more than one priced tag.
  rank       int not null default 100,
  created_at timestamptz not null default now(),
  unique (plan_id, tag_id)
);

create index plan_tag_amounts_plan_idx on plan_tag_amounts (plan_id, rank);

alter table plan_tag_amounts enable row level security;

create policy plan_tag_amounts_select on plan_tag_amounts
  for select using (
    exists (select 1 from plans p where p.id = plan_id and is_group_member(p.group_id))
  );

create policy plan_tag_amounts_write on plan_tag_amounts
  for all using (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'admin'))
  )
  with check (
    exists (select 1 from plans p where p.id = plan_id and has_group_role(p.group_id, 'admin'))
  );

-- Step 3 of the chain slots in between the override and the default.
create or replace function plan_obligation_amount(p_plan_id uuid, p_member_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_override plan_member_overrides;
  v_tag_amount bigint;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    return null;
  end if;

  -- Open giving issues no obligations: members give what they wish.
  if v_plan.kind = 'open' then
    return null;
  end if;

  -- A susu bills its rotation and nobody else.
  if v_plan.kind = 'rotating' and not exists (
    select 1 from rotation_slots s
    where s.plan_id = p_plan_id and s.member_id = p_member_id
  ) then
    return null;
  end if;

  -- A contribution scoped to a tag bills only the members carrying it.
  if v_plan.audience_tag_id is not null and not exists (
    select 1 from member_tags mt
    where mt.tag_id = v_plan.audience_tag_id and mt.member_id = p_member_id
  ) then
    return null;
  end if;

  select * into v_override
  from plan_member_overrides
  where plan_id = p_plan_id and member_id = p_member_id;

  -- An override row that exists with a NULL amount means exempt.
  if v_override.id is not null then
    return v_override.amount;
  end if;

  -- The dearest-ranked tag this member carries that this plan prices.
  select ta.amount into v_tag_amount
  from plan_tag_amounts ta
  join member_tags mt on mt.tag_id = ta.tag_id and mt.member_id = p_member_id
  where ta.plan_id = p_plan_id
  order by ta.rank, ta.created_at
  limit 1;

  if found then
    return v_tag_amount;
  end if;

  return v_plan.default_amount;
end;
$$;

revoke execute on function plan_obligation_amount(uuid, uuid) from anon, authenticated;

/**
 * Brings issued obligations back to what the rules now say they should cost.
 *
 * Refuses once a single payment exists on the plan: from that moment the books
 * are live and members keep the amount they were told. That is invariant 5, and
 * checking it here rather than at each call site means no future caller can
 * forget it.
 *
 * Only ever changes `amount_due`. Issuing and waiving belong to
 * reissue_plan_obligations.
 */
create function reprice_plan_obligations(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if plan_has_money(p_plan_id) then
    return 0;
  end if;

  update obligations o
  set amount_due = plan_obligation_amount(p_plan_id, o.member_id)
  from cycles c
  where c.id = o.cycle_id
    and c.plan_id = p_plan_id
    and not o.waived
    -- A member who is no longer billed keeps their row for reissue to waive;
    -- amount_due is NOT NULL, so there is nothing to write here anyway.
    and plan_obligation_amount(p_plan_id, o.member_id) is not null
    and o.amount_due is distinct from plan_obligation_amount(p_plan_id, o.member_id);

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function reprice_plan_obligations(uuid) from anon, authenticated;

/**
 * Prices a tag on a contribution.
 *
 * Refused for a susu: everyone in a rotation pays the same, because the pot is
 * what makes the payout worth collecting. Refused for open giving, which issues
 * no obligations at all.
 */
create function set_plan_tag_amount(
  p_plan_id uuid,
  p_tag_id uuid,
  p_amount bigint,
  p_rank int default 100
)
returns plan_tag_amounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_row plan_tag_amounts;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can set what a tag pays';
  end if;

  if v_plan.kind = 'rotating' then
    raise exception 'Everyone in a susu contributes the same amount each period';
  end if;

  if v_plan.kind = 'open' then
    raise exception 'Open giving has no set amount — members give what they wish';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'Enter an amount of zero or more';
  end if;

  if not exists (select 1 from tags where id = p_tag_id and group_id = v_plan.group_id) then
    raise exception 'That tag belongs to another group';
  end if;

  insert into plan_tag_amounts (plan_id, tag_id, amount, rank)
  values (p_plan_id, p_tag_id, p_amount, coalesce(p_rank, 100))
  on conflict (plan_id, tag_id) do update
    set amount = excluded.amount,
        rank   = excluded.rank
  returning * into v_row;

  perform reprice_plan_obligations(p_plan_id);

  return v_row;
end;
$$;

/** Puts a tag back on the plan's default amount. */
create function clear_plan_tag_amount(p_plan_id uuid, p_tag_id uuid)
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
    raise exception 'Only an admin or owner can set what a tag pays';
  end if;

  delete from plan_tag_amounts where plan_id = p_plan_id and tag_id = p_tag_id;

  perform reprice_plan_obligations(p_plan_id);
end;
$$;

grant execute on function set_plan_tag_amount(uuid, uuid, bigint, int) to authenticated;
grant execute on function clear_plan_tag_amount(uuid, uuid) to authenticated;

-- update_plan carried the third hand-written copy of the resolution rule. It
-- knew about overrides but could not know about tag amounts, so editing a
-- plan's default amount would have flattened every tag price back to it.
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

  -- No-op once anything has been paid, and no-op when nothing actually changed.
  perform reprice_plan_obligations(p_plan_id);

  perform realign_cycles(p_plan_id);
  perform generate_due_cycles(p_plan_id);
  perform prune_misaligned_cycles(p_plan_id);

  return v_plan;
end;
$$;

-- Deleting a priced tag would silently move its members onto the plan default,
-- which is a price change nobody asked for. Same refusal as an audience tag.
create or replace function delete_tag(p_tag_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag tags;
  v_plan_name text;
begin
  select * into v_tag from tags where id = p_tag_id;
  if v_tag.id is null then
    raise exception 'Tag not found';
  end if;

  if not has_group_role(v_tag.group_id, 'admin') then
    raise exception 'Only an admin or owner can delete a tag';
  end if;

  select name into v_plan_name from plans where audience_tag_id = p_tag_id limit 1;
  if v_plan_name is not null then
    raise exception
      'The contribution "%" is only for this tag. Point it at everyone, or end it, before deleting the tag.',
      v_plan_name;
  end if;

  select p.name into v_plan_name
  from plan_tag_amounts ta
  join plans p on p.id = ta.plan_id
  where ta.tag_id = p_tag_id
  limit 1;

  if v_plan_name is not null then
    raise exception
      'The contribution "%" charges this tag its own amount. Clear that amount before deleting the tag.',
      v_plan_name;
  end if;

  delete from tags where id = p_tag_id;
end;
$$;

/** What each tag pays on a contribution, for the amounts screen. */
create view plan_tag_amount_details
with (security_invoker = true)
as
select
  ta.plan_id,
  ta.tag_id,
  t.name    as tag_name,
  t.colour  as tag_colour,
  ta.amount,
  ta.rank,
  (select count(*) from member_tags mt where mt.tag_id = ta.tag_id)::int as member_count
from plan_tag_amounts ta
join tags t on t.id = ta.tag_id;

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
        'reissue_plan_obligations', 'reissue_plans_for_tag', 'create_tag',
        'rename_tag', 'delete_tag', 'set_tag_members', 'set_member_tags',
        'set_plan_audience', 'set_plan_tag_amount', 'clear_plan_tag_amount',
        'reprice_plan_obligations'
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
