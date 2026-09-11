-- Three things: a member record that never learned its owner's phone number,
-- a clearer split between "runs the books" and "sets policy", and a way to
-- change somebody's role.

-- ---------------------------------------------------------------------------
-- 1. The phone that went missing
--
-- Adding a verified number updated `profiles.phone` and stopped there.
-- `group_members.phone` is a separate column — the one every members screen
-- reads — and `create_group` never set it at all, so an owner who added their
-- number by OTP still showed as "No phone number" on their own member card.
--
-- Only ever fills a BLANK one. A number a treasurer typed is left alone, for
-- the same reason `set_my_name` leaves their names alone: they entered it so
-- the group would recognise the person.
-- ---------------------------------------------------------------------------

create or replace function sync_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phone is distinct from old.phone
     or new.phone_confirmed_at is distinct from old.phone_confirmed_at then

    update public.profiles
       set phone = case when new.phone_confirmed_at is not null then new.phone end
     where id = new.id;

    -- Carry it onto every member record this account holds that has no number
    -- of its own. phone_e164 follows via the group_members trigger.
    if new.phone_confirmed_at is not null and new.phone is not null then
      update public.group_members
         set phone = new.phone
       where user_id = new.id
         and phone is null;
    end if;
  end if;

  return new;
end;
$$;

/**
 * Creating a group made an owner record with no phone, which then could not be
 * matched to anything and displayed as blank. Take it from the profile.
 */
create or replace function create_group(p_name text, p_currency text default 'GHS')
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_phone text;
  v_group groups;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Group name is required';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Owner'), phone
    into v_name, v_phone
  from profiles
  where id = v_user_id;

  insert into groups (name, join_code, currency, created_by, join_code_expires_at)
  values (
    trim(p_name), gen_join_code(), upper(p_currency), v_user_id,
    now() + default_join_code_ttl()
  )
  returning * into v_group;

  insert into group_members (group_id, user_id, full_name, phone, role, status)
  values (v_group.id, v_user_id, coalesce(v_name, 'Owner'), v_phone, 'owner', 'active');

  return v_group;
end;
$$;

-- Repair the records that already exist, blanks only.
update group_members m
   set phone = p.phone
  from profiles p
 where p.id = m.user_id
   and m.phone is null
   and p.phone is not null;

-- ---------------------------------------------------------------------------
-- 2. Treasurer runs the books; admin sets policy
--
-- A treasurer already recorded payments and expenses but could not add the
-- member they were recording a payment for, nor set up the contribution the
-- payment was against. That is not a coherent job.
--
-- What deliberately stays with admins and owners, because each is a control
-- rather than a task:
--
--   * approve_expense — a treasurer records spending, someone else agrees to
--     it. Collapsing those two into one person removes the only check on money
--     leaving the group.
--   * reverse_payment, delete_plan — rewriting or removing history.
--   * the invite code and join approvals — who gets into the group at all.
--   * set_member_role — who holds any of this authority.
--   * the susu rotation — it fixes who collects and when, and the plan's end.
-- ---------------------------------------------------------------------------

-- Rewrites only the ROLE TEST inside each listed function, leaving every other
-- line of its body exactly as it was. Restating thirteen function definitions
-- here would be the same duplication that has already cost this project three
-- bugs; this cannot drift from what those functions actually do.
--
-- The pattern is deliberately narrow: `has_group_role(<anything but a comma>,
-- 'admin')` and nothing else. An owner-only check inside the same function —
-- `add_member`'s "only the owner may mint another owner" — says 'owner' and is
-- untouched.
--
-- It counts what it changed and raises if the total is wrong, because a
-- rewrite that silently matches nothing is indistinguishable from one that
-- worked, and this one decides who may bill whom.
do $$
declare
  r record;
  v_new text;
  v_changed int := 0;
  v_expected constant int := 13;
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'add_member', 'create_plan', 'update_plan',
        'create_tag', 'rename_tag', 'delete_tag', 'set_tag_members', 'set_member_tags',
        'set_plan_audience', 'set_plan_tag_amount', 'clear_plan_tag_amount',
        'set_plan_override', 'clear_plan_override'
      )
  loop
    v_new := regexp_replace(
      r.def,
      'has_group_role\(([^,]+),\s*''admin''\)',
      'has_group_role(\1, ''treasurer'')',
      'g'
    );

    if v_new is distinct from r.def then
      execute v_new;
      v_changed := v_changed + 1;
    end if;
  end loop;

  if v_changed <> v_expected then
    raise exception
      'Expected to lower % role checks to treasurer, changed %. Check the function list.',
      v_expected, v_changed;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Changing somebody's role
-- ---------------------------------------------------------------------------

/**
 * Promotes or demotes a member.
 *
 * Three refusals, each protecting something that cannot be undone from inside
 * the app:
 *   * only an owner may create or remove another owner;
 *   * the last owner cannot be demoted, or the group has nobody who can
 *     appoint one;
 *   * you cannot change your own role — an admin could otherwise quietly grant
 *     themselves everything, and an owner could strand the group by accident.
 */
create function set_member_role(p_member_id uuid, p_role member_role)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
  v_owners int;
begin
  select * into v_member from group_members where id = p_member_id;
  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  if not has_group_role(v_member.group_id, 'admin') then
    raise exception 'Only an admin or owner can change a role';
  end if;

  if v_member.user_id is not null and v_member.user_id = auth.uid() then
    raise exception 'You cannot change your own role. Ask another admin or the owner.';
  end if;

  if (p_role = 'owner' or v_member.role = 'owner')
     and not has_group_role(v_member.group_id, 'owner') then
    raise exception 'Only the owner can appoint or replace another owner';
  end if;

  if v_member.role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners
    from group_members
    where group_id = v_member.group_id
      and role = 'owner'
      and status = 'active';

    if v_owners <= 1 then
      raise exception 'This is the only owner. Appoint another owner first.';
    end if;
  end if;

  update group_members
     set role = p_role
   where id = p_member_id
  returning * into v_member;

  return v_member;
end;
$$;

grant execute on function set_member_role(uuid, member_role) to authenticated;
