-- Linking a phone sign-in to the member record a treasurer already created.
--
-- Without this, a member who signs in gets nothing useful: they would enter a
-- join code and receive a SECOND, empty membership while their real record —
-- with every contribution they have ever made — sits beside it unlinked. That
-- is the whole problem this is meant to solve.
--
-- This REVERSES a decision recorded in 20260802020000_members.sql, which said
-- linking "is a deliberate admin action, not something we guess at from a phone
-- number". The reasoning has changed because the evidence has: that note was
-- about an UNVERIFIED number typed at signup. A number Supabase has confirmed by
-- OTP proves possession of the SIM, which is materially stronger, and it is the
-- same proof a treasurer relies on when they phone the member.
--
-- Guard rails, because the residual risk is a treasurer's typo handing a
-- stranger someone else's standings:
--
--   * ONLY a confirmed phone (auth.users.phone_confirmed_at) can claim anything.
--   * ONLY unclaimed rows (user_id IS NULL) — a record already belonging to
--     someone is never taken from them.
--   * TWO records with the same number in one group claims NEITHER. That is a
--     data error, not a person with two memberships, and it is unresolvable
--     here: there is no way to know which one was meant.
--   * Every claim is recorded and shown to the group's admins, so a mistake is
--     visible after the fact rather than silent.

create table member_link_events (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id) on delete cascade,
  -- Null once the member row is gone; member_name keeps the event readable.
  member_id  uuid references group_members (id) on delete set null,
  user_id    uuid references auth.users (id) on delete cascade,
  phone_e164 text not null,
  kind       text not null check (kind in ('linked', 'ambiguous')),
  -- Snapshot: an admin reading this next month should not need the member row.
  member_name text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references group_members (id) on delete set null
);

create index member_link_events_group_idx
  on member_link_events (group_id, created_at desc);

-- One alert per unresolved clash, rather than a new row every time the member
-- reopens the app and the claim runs again.
create unique index member_link_events_open_ambiguity_idx
  on member_link_events (group_id, phone_e164)
  where kind = 'ambiguous' and acknowledged_at is null;

alter table member_link_events enable row level security;

-- Admins read and acknowledge. Nobody writes directly: every row is created by
-- the SECURITY DEFINER claim below, so an event cannot be forged.
create policy member_link_events_select on member_link_events
  for select using (has_group_role(group_id, 'admin'));

create policy member_link_events_update on member_link_events
  for update using (has_group_role(group_id, 'admin'))
  with check (has_group_role(group_id, 'admin'));

/**
 * The signed-in user's own verified Ghana number, or NULL.
 *
 * NULL covers every reason a caller must not claim anything: not signed in, no
 * phone on the account, a phone that was never confirmed, or one that is not a
 * Ghana mobile. Callers treat all four the same way — do nothing.
 */
create function current_verified_phone()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_confirmed timestamptz;
begin
  if auth.uid() is null then
    return null;
  end if;

  select u.phone, u.phone_confirmed_at
    into v_phone, v_confirmed
  from auth.users u
  where u.id = auth.uid();

  -- An unconfirmed number is just a string somebody typed.
  if v_phone is null or v_confirmed is null then
    return null;
  end if;

  return normalise_gh_phone(v_phone);
end;
$$;

revoke execute on function current_verified_phone() from anon;

/**
 * Claims every member record across every group that matches the caller's
 * verified phone, and returns how many were claimed.
 *
 * Safe to call on every launch: claiming is idempotent, and a group where
 * nothing matches is simply skipped. That is deliberate — a treasurer may add
 * someone to a new group long after they first signed in, and the member should
 * not have to do anything to see it.
 */
create function claim_memberships()
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
  v_candidates int;
  v_member group_members;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  v_phone := current_verified_phone();
  if v_phone is null then
    return 0;
  end if;

  for r_group in
    select m.group_id, count(*) as candidates
    from group_members m
    where m.phone_e164 = v_phone
      and m.user_id is null
      and m.status <> 'left'
    group by m.group_id
  loop
    v_candidates := r_group.candidates;

    -- Two records, one number, one group: unresolvable. Tell the admins and
    -- leave both alone rather than pick one and be wrong half the time.
    if v_candidates > 1 then
      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (r_group.group_id, null, v_user, v_phone, 'ambiguous', null)
      on conflict do nothing;
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
    set user_id = v_user
    where group_id = r_group.group_id
      and phone_e164 = v_phone
      and user_id is null
      and status <> 'left'
    returning * into v_member;

    if v_member.id is not null then
      v_claimed := v_claimed + 1;

      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (r_group.group_id, v_member.id, v_user, v_phone, 'linked', v_member.full_name);
    end if;
  end loop;

  return v_claimed;
end;
$$;

/** Dismisses a link alert once an admin has looked at it. */
create function acknowledge_member_link(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event member_link_events;
begin
  select * into v_event from member_link_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'That notice no longer exists';
  end if;

  if not has_group_role(v_event.group_id, 'admin') then
    raise exception 'Only an admin or owner can dismiss a notice';
  end if;

  update member_link_events
  set acknowledged_at = now(),
      acknowledged_by = current_member_id(v_event.group_id)
  where id = p_event_id;
end;
$$;

grant execute on function claim_memberships() to authenticated;
grant execute on function acknowledge_member_link(uuid) to authenticated;

-- join_group must adopt an existing record rather than create a second one.
-- Someone with two years of contributions who types the join code should land
-- on their own history, not an empty membership beside it.
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
  v_candidates int;
  v_member group_members;
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

  -- Adopt the record the treasurer already made for this number.
  v_phone := current_verified_phone();

  if v_phone is not null then
    select count(*) into v_candidates
    from group_members
    where group_id = v_group.id
      and phone_e164 = v_phone
      and user_id is null
      and status <> 'left';

    if v_candidates > 1 then
      -- Refused rather than resolved: creating a third record here would bury
      -- the problem under another one.
      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (v_group.id, null, v_user_id, v_phone, 'ambiguous', null)
      on conflict do nothing;

      raise exception
        'There are two member records with your number in this group. Ask an admin to remove the duplicate, then try again.';
    end if;

    if v_candidates = 1 then
      update group_members
      set user_id = v_user_id,
          status = case when status = 'invited' then 'active'::member_status else status end
      where group_id = v_group.id
        and phone_e164 = v_phone
        and user_id is null
        and status <> 'left'
      returning * into v_member;

      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (v_group.id, v_member.id, v_user_id, v_phone, 'linked', v_member.full_name);

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

/** What an admin needs to see: who was matched to which record, and any clash. */
create view member_link_notices
with (security_invoker = true)
as
select
  e.id            as event_id,
  e.group_id,
  e.kind,
  e.phone_e164,
  e.member_id,
  coalesce(e.member_name, m.full_name) as member_name,
  e.created_at,
  e.acknowledged_at
from member_link_events e
left join group_members m on m.id = e.member_id;

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
        'current_verified_phone', 'acknowledge_member_link'
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
