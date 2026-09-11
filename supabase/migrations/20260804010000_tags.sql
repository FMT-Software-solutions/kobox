-- Tags — sub-groups within a group.
--
-- The requirement: a contribution that only some members owe. Executives pay a
-- levy the ordinary members do not; a committee runs a collection of its own.
--
-- Naming: "group" already means the organisation, so these are Tags. A member
-- can carry several.
--
-- A plan's `audience_tag_id` is NULL for "everyone" and set for "only this tag".
-- No new arithmetic is needed anywhere: every total in the app derives from
-- obligations, so scoping a contribution simply issues fewer of them. All of
-- that funnels through plan_obligation_amount, which already answers "is this
-- member billed by this plan, and how much" for every other caller.

create table tags (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id) on delete cascade,
  name       text not null,
  -- Hex, so the app can render a chip without a lookup table.
  colour     text not null default '#0B7A5C' check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  check (length(trim(name)) > 0)
);

create index tags_group_idx on tags (group_id);

-- Two tags called "Executives" in one group would be indistinguishable in every
-- picker in the app.
create unique index tags_group_name_idx on tags (group_id, lower(trim(name)));

create table member_tags (
  tag_id     uuid not null references tags (id) on delete cascade,
  member_id  uuid not null references group_members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_id, member_id)
);

create index member_tags_member_idx on member_tags (member_id);

-- NULL means everyone, which is what every existing plan means.
-- ON DELETE RESTRICT: silently widening a contribution to the whole group
-- because someone tidied up a tag would be a disaster. delete_tag says so.
alter table plans
  add column audience_tag_id uuid references tags (id) on delete restrict;

create index plans_audience_idx on plans (audience_tag_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — same shape as everything else: members read, admins write
-- ---------------------------------------------------------------------------

alter table tags        enable row level security;
alter table member_tags enable row level security;

create policy tags_select on tags
  for select using (is_group_member(group_id));

create policy tags_write on tags
  for all using (has_group_role(group_id, 'admin'))
  with check (has_group_role(group_id, 'admin'));

create policy member_tags_select on member_tags
  for select using (
    exists (select 1 from tags t where t.id = tag_id and is_group_member(t.group_id))
  );

create policy member_tags_write on member_tags
  for all using (
    exists (select 1 from tags t where t.id = tag_id and has_group_role(t.group_id, 'admin'))
  )
  with check (
    exists (select 1 from tags t where t.id = tag_id and has_group_role(t.group_id, 'admin'))
  );

-- ---------------------------------------------------------------------------
-- Who a plan bills
-- ---------------------------------------------------------------------------

-- One more reason to answer "not billed", alongside open giving, exemption and
-- a susu you hold no position in.
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

  return v_plan.default_amount;
end;
$$;

revoke execute on function plan_obligation_amount(uuid, uuid) from anon, authenticated;

-- Joining a tag halfway through raises the same question as joining the group
-- halfway through: do you owe what you missed? add_member already asks it, so
-- reissue has to be able to carry the answer.
drop function if exists reissue_plan_obligations(uuid);

create function reissue_plan_obligations(
  p_plan_id uuid,
  p_include_past_periods boolean default true
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_changed int := 0;
  v_rows int;
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
    and (p_include_past_periods or c.status = 'open')
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
    and plan_obligation_amount(p_plan_id, o.member_id) is not null
    and (p_include_past_periods or c.status = 'open');

  get diagnostics v_rows = row_count;
  v_changed := v_changed + v_rows;

  -- 3. Someone outside the audience stops owing — unless they have paid.
  --    Never limited to open periods: leaving a tag clears what you never owed.
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

revoke execute on function reissue_plan_obligations(uuid, boolean) from anon, authenticated;

/** Every plan scoped to this tag has to catch up after its membership changes. */
create function reissue_plans_for_tag(p_tag_id uuid, p_include_past_periods boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id from plans
    where audience_tag_id = p_tag_id and status <> 'ended'
  loop
    perform reissue_plan_obligations(r.id, p_include_past_periods);
  end loop;
end;
$$;

revoke execute on function reissue_plans_for_tag(uuid, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Managing tags
-- ---------------------------------------------------------------------------

create function create_tag(p_group_id uuid, p_name text, p_colour text default '#0B7A5C')
returns tags
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag tags;
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can create a tag';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the tag a name';
  end if;

  if exists (
    select 1 from tags
    where group_id = p_group_id and lower(trim(name)) = lower(trim(p_name))
  ) then
    raise exception 'There is already a tag called %', trim(p_name);
  end if;

  insert into tags (group_id, name, colour)
  values (p_group_id, trim(p_name), coalesce(p_colour, '#0B7A5C'))
  returning * into v_tag;

  return v_tag;
end;
$$;

create function rename_tag(p_tag_id uuid, p_name text default null, p_colour text default null)
returns tags
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag tags;
begin
  select * into v_tag from tags where id = p_tag_id;
  if v_tag.id is null then
    raise exception 'Tag not found';
  end if;

  if not has_group_role(v_tag.group_id, 'admin') then
    raise exception 'Only an admin or owner can change a tag';
  end if;

  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'Give the tag a name';
  end if;

  if p_name is not null and exists (
    select 1 from tags
    where group_id = v_tag.group_id
      and lower(trim(name)) = lower(trim(p_name))
      and id <> p_tag_id
  ) then
    raise exception 'There is already a tag called %', trim(p_name);
  end if;

  update tags
  set name   = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
      colour = coalesce(p_colour, colour)
  where id = p_tag_id
  returning * into v_tag;

  return v_tag;
end;
$$;

/**
 * Deleting a tag that scopes a contribution is refused rather than cascading:
 * dropping the audience would quietly widen that contribution to the whole
 * group and bill everybody.
 */
create function delete_tag(p_tag_id uuid)
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

  delete from tags where id = p_tag_id;
end;
$$;

/**
 * Replaces a tag's membership wholesale — the screen shows a checklist, so the
 * honest RPC takes the whole list rather than making the client diff it.
 *
 * `p_include_past_periods` answers the same question add_member asks: someone
 * joining Executives in June either owes the levy from January or does not, and
 * the group decides that, not the app.
 */
create function set_tag_members(
  p_tag_id uuid,
  p_member_ids uuid[],
  p_include_past_periods boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tag tags;
  v_ids uuid[] := coalesce(p_member_ids, '{}'::uuid[]);
begin
  select * into v_tag from tags where id = p_tag_id;
  if v_tag.id is null then
    raise exception 'Tag not found';
  end if;

  if not has_group_role(v_tag.group_id, 'admin') then
    raise exception 'Only an admin or owner can change who carries a tag';
  end if;

  if exists (
    select 1
    from unnest(v_ids) m
    where not exists (
      select 1 from group_members gm
      where gm.id = m and gm.group_id = v_tag.group_id and gm.status = 'active'
    )
  ) then
    raise exception 'Everyone carrying a tag must be an active member of the group';
  end if;

  delete from member_tags
  where tag_id = p_tag_id and member_id <> all (v_ids);

  insert into member_tags (tag_id, member_id)
  select p_tag_id, m from unnest(v_ids) m
  on conflict (tag_id, member_id) do nothing;

  perform reissue_plans_for_tag(p_tag_id, p_include_past_periods);

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

/** The same edit from the member's side: which tags does this person carry. */
create function set_member_tags(
  p_member_id uuid,
  p_tag_ids uuid[],
  p_include_past_periods boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
  v_ids uuid[] := coalesce(p_tag_ids, '{}'::uuid[]);
  v_tag uuid;
  v_touched uuid[];
begin
  select * into v_member from group_members where id = p_member_id;
  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  if not has_group_role(v_member.group_id, 'admin') then
    raise exception 'Only an admin or owner can change a member''s tags';
  end if;

  if exists (
    select 1
    from unnest(v_ids) t
    where not exists (
      select 1 from tags where id = t and group_id = v_member.group_id
    )
  ) then
    raise exception 'That tag belongs to another group';
  end if;

  -- Every tag on either side of the change may have plans to reconcile.
  select array_agg(distinct t) into v_touched
  from (
    select unnest(v_ids) as t
    union
    select tag_id from member_tags where member_id = p_member_id
  ) s;

  delete from member_tags
  where member_id = p_member_id and tag_id <> all (v_ids);

  insert into member_tags (tag_id, member_id)
  select t, p_member_id from unnest(v_ids) t
  on conflict (tag_id, member_id) do nothing;

  foreach v_tag in array coalesce(v_touched, '{}'::uuid[]) loop
    perform reissue_plans_for_tag(v_tag, p_include_past_periods);
  end loop;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

/**
 * Points an existing contribution at a tag, or back at the whole group.
 *
 * Allowed even once money is in: narrowing waives what the members outside the
 * tag had not paid, and reissue_plan_obligations refuses to touch an obligation
 * that carries money, so nothing already collected can be lost.
 */
create function set_plan_audience(p_plan_id uuid, p_tag_id uuid default null)
returns plans
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
    raise exception 'Only an admin or owner can change who a contribution is for';
  end if;

  if v_plan.kind = 'rotating' then
    raise exception 'A susu is already limited to the members in its rotation';
  end if;

  if p_tag_id is not null and not exists (
    select 1 from tags where id = p_tag_id and group_id = v_plan.group_id
  ) then
    raise exception 'That tag belongs to another group';
  end if;

  update plans set audience_tag_id = p_tag_id where id = p_plan_id
  returning * into v_plan;

  perform reissue_plan_obligations(p_plan_id);

  return v_plan;
end;
$$;

grant execute on function create_tag(uuid, text, text) to authenticated;
grant execute on function rename_tag(uuid, text, text) to authenticated;
grant execute on function delete_tag(uuid) to authenticated;
grant execute on function set_tag_members(uuid, uuid[], boolean) to authenticated;
grant execute on function set_member_tags(uuid, uuid[], boolean) to authenticated;
grant execute on function set_plan_audience(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_plan gains an audience
-- ---------------------------------------------------------------------------

create or replace function create_plan(
  p_group_id uuid,
  p_name text,
  p_kind plan_kind,
  p_frequency plan_frequency,
  p_default_amount bigint default null,
  p_grace_days int default 0,
  p_start_date date default null,
  p_end_date date default null,
  p_audience_tag_id uuid default null
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

  if p_audience_tag_id is not null then
    if p_kind = 'rotating' then
      raise exception 'A susu is already limited to the members in its rotation';
    end if;

    if not exists (select 1 from tags where id = p_audience_tag_id and group_id = p_group_id) then
      raise exception 'That tag belongs to another group';
    end if;
  end if;

  insert into plans (
    group_id, name, kind, frequency, status,
    default_amount, start_date, end_date, grace_days, created_by, audience_tag_id
  )
  values (
    p_group_id, trim(p_name), p_kind, p_frequency, 'active',
    case when p_kind = 'open' then null else p_default_amount end,
    v_start, p_end_date, greatest(p_grace_days, 0), v_member_id,
    case when p_kind = 'rotating' then null else p_audience_tag_id end
  )
  returning * into v_plan;

  perform generate_due_cycles(v_plan.id);

  return v_plan;
end;
$$;

-- The gotcha that has bitten this project twice: create or replace ADDS an
-- overload when the argument list changes, and PostgREST then refuses to choose.
drop function if exists public.create_plan(
  uuid, text, plan_kind, plan_frequency, bigint, int, date, date
);

grant execute on function create_plan(
  uuid, text, plan_kind, plan_frequency, bigint, int, date, date, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- What the tag screens read
-- ---------------------------------------------------------------------------

create view tag_summaries
with (security_invoker = true)
as
select
  t.id       as tag_id,
  t.group_id,
  t.name,
  t.colour,
  t.created_at,
  (select count(*) from member_tags mt where mt.tag_id = t.id)::int as member_count,
  (select count(*) from plans p
   where p.audience_tag_id = t.id and p.status <> 'ended')::int      as plan_count
from tags t;

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
        'set_plan_audience'
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
