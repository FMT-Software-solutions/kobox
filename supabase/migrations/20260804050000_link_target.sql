-- One place decides which record a phone number claims.
--
-- claim_memberships() and join_group() were each carrying their own copy of the
-- matching rule — unclaimed, not left, count the candidates, refuse on two.
-- Two copies of a rule is how this project has already shipped three bugs, and
-- this particular rule decides who can see someone else's money.
--
-- Extracting it also makes it TESTABLE. The claim itself needs a phone Supabase
-- has confirmed by OTP, which the ledger checks cannot mint with an anon key —
-- so without this the adoption and ambiguity paths would ship unverified.
-- link_target_for_phone() takes the number as an argument, so the ledger checks
-- exercise the real rule with any number they like.
--
-- It is not a hole: you may ask about YOUR OWN verified number, or about any
-- number in a group you administer — and an admin can already read every
-- member's phone in their own group, so nothing new is exposed.

/**
 * Which unclaimed member record in `p_group_id` belongs to `p_phone`.
 *
 * Always returns exactly one row:
 *   candidates = 0  → nothing to claim here
 *   candidates = 1  → member_id is the record to claim
 *   candidates > 1  → ambiguous; member_id is NULL and the caller must refuse
 */
create function link_target_for_phone(p_group_id uuid, p_phone text)
returns table (candidates int, member_id uuid, member_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text := normalise_gh_phone(p_phone);
begin
  if v_phone is null then
    return query select 0, null::uuid, null::text;
    return;
  end if;

  -- Your own verified number, or a number in a group you run. Anything else is
  -- a stranger asking who owns a phone, which is nobody's business.
  if v_phone is distinct from current_verified_phone()
     and not has_group_role(p_group_id, 'admin') then
    raise exception 'Not allowed to look up that number';
  end if;

  return query
  select
    count(*)::int,
    -- Only meaningful when exactly one matched; NULL is the caller's signal to
    -- stop, so an ambiguous group can never be resolved by accident.
    case when count(*) = 1 then min(m.id) end,
    case when count(*) = 1 then min(m.full_name) end
  from group_members m
  where m.group_id = p_group_id
    and m.phone_e164 = v_phone
    and m.user_id is null
    and m.status <> 'left';
end;
$$;

grant execute on function link_target_for_phone(uuid, text) to authenticated;

-- Both callers now ask that one function.
create or replace function claim_memberships()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_phone text;
  v_claimed int := 0;
  r_group record;
  v_target record;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  v_phone := current_verified_phone();
  if v_phone is null then
    return 0;
  end if;

  for r_group in
    select distinct m.group_id
    from group_members m
    where m.phone_e164 = v_phone
      and m.user_id is null
      and m.status <> 'left'
  loop
    select * into v_target from link_target_for_phone(r_group.group_id, v_phone);

    -- Two records, one number, one group: unresolvable. Tell the admins and
    -- leave both alone rather than pick one and be wrong half the time.
    if v_target.candidates > 1 then
      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (r_group.group_id, null, v_user, v_phone, 'ambiguous', null)
      on conflict do nothing;
      continue;
    end if;

    if v_target.member_id is null then
      continue;
    end if;

    -- Already hold a membership here under a different record. Claiming would
    -- violate unique (group_id, user_id), and merging two histories is an admin
    -- decision, not something to infer.
    if exists (
      select 1 from group_members
      where group_id = r_group.group_id and user_id = v_user
    ) then
      continue;
    end if;

    update group_members
    set user_id = v_user,
        status = case when status = 'invited' then 'active'::member_status else status end
    where id = v_target.member_id
      and user_id is null;

    if found then
      v_claimed := v_claimed + 1;

      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (r_group.group_id, v_target.member_id, v_user, v_phone, 'linked', v_target.member_name);
    end if;
  end loop;

  return v_claimed;
end;
$$;

create or replace function join_group(p_join_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_group groups;
  v_existing group_members;
  v_phone text;
  v_target record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_group
  from groups
  where upper(join_code) = upper(trim(p_join_code));

  if v_group.id is null then
    raise exception 'No group found with that code';
  end if;

  select * into v_existing
  from group_members
  where group_id = v_group.id and user_id = v_user_id;

  if v_existing.id is not null then
    -- Re-joining after leaving simply reactivates the original membership, so
    -- the member keeps their contribution history.
    if v_existing.status <> 'active' then
      update group_members set status = 'active' where id = v_existing.id;
    end if;
    return v_group;
  end if;

  -- Adopt the record the treasurer already made for this number, rather than
  -- creating a second empty one beside two years of contributions.
  v_phone := current_verified_phone();

  if v_phone is not null then
    select * into v_target from link_target_for_phone(v_group.id, v_phone);

    if v_target.candidates > 1 then
      -- Refused rather than resolved: a third record would bury the problem
      -- under another one.
      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (v_group.id, null, v_user_id, v_phone, 'ambiguous', null)
      on conflict do nothing;

      raise exception
        'There are two member records with your number in this group. Ask an admin to remove the duplicate, then try again.';
    end if;

    if v_target.member_id is not null then
      update group_members
      set user_id = v_user_id,
          status = case when status = 'invited' then 'active'::member_status else status end
      where id = v_target.member_id
        and user_id is null;

      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (v_group.id, v_target.member_id, v_user_id, v_phone, 'linked', v_target.member_name);

      return v_group;
    end if;
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Member')
    into v_name
  from profiles
  where id = v_user_id;

  insert into group_members (group_id, user_id, full_name, role, status)
  values (v_group.id, v_user_id, coalesce(v_name, 'Member'), 'member', 'active');

  return v_group;
end;
$$;

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
        'reprice_plan_obligations', 'normalise_gh_phone', 'claim_memberships',
        'current_verified_phone', 'acknowledge_member_link', 'link_target_for_phone'
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
