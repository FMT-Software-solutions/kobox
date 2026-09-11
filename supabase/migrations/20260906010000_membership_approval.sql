-- Joining a group becomes a request, and a phone number becomes mandatory.
--
-- Four things are fixed or added here, and they are one change because they all
-- turn on the same question: who is allowed into a group that holds money.
--
--   1. GAP — `join_group` never issued obligations. `add_member` does, so a
--      treasurer-added member was billed for the open period and a self-joined
--      one was not, silently, until the next cycle opened.
--   2. GAP — `claim_memberships` skipped a group if ANY row there carried the
--      caller's user_id, with no status filter. A duplicate marked `left` still
--      blocked the real record from ever being claimed, so the obvious manual
--      repair did not work.
--   3. A join code is now an invitation, not a permanent open door: it expires,
--      it can be regenerated, and joining with it can require approval.
--   4. A member record without a phone cannot be linked to the person it
--      describes, because a verified phone is the only signal linking uses.
--      Phone becomes required.

-- ---------------------------------------------------------------------------
-- Group join policy
-- ---------------------------------------------------------------------------

alter table groups
  add column if not exists join_code_expires_at timestamptz,
  add column if not exists join_requires_approval boolean not null default true;

comment on column groups.join_code_expires_at is
  'When the current code stops working. NULL means it never expires — only '
  'groups created before codes could expire.';

-- Existing groups keep working rather than locking their members out overnight,
-- but they do not stay open forever either.
update groups
   set join_code_expires_at = now() + interval '30 days'
 where join_code_expires_at is null;

/** How long a freshly minted code lasts, unless asked for something else. */
create function default_join_code_ttl()
returns interval
language sql
immutable
as $$ select interval '14 days' $$;

-- ---------------------------------------------------------------------------
-- One place decides what a member owes on joining
--
-- This rule existed only inside `add_member`, which is why `join_group` did not
-- have it. Extracting it is the same move `plan_obligation_amount` already
-- represents: the moment a rule has two callers it must have one home.
-- ---------------------------------------------------------------------------

create function issue_member_obligations(
  p_member_id uuid,
  p_include_past_periods boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
  v_rows int;
begin
  select * into v_member from group_members where id = p_member_id;
  if v_member.id is null then
    raise exception 'Member not found';
  end if;

  -- Only an active member is billed. A pending request must never accrue a
  -- balance for a group that may yet decline them.
  if v_member.status <> 'active' then
    return 0;
  end if;

  insert into obligations (cycle_id, member_id, amount_due)
  select c.id, v_member.id, plan_obligation_amount(p.id, v_member.id)
  from cycles c
  join plans p on p.id = c.plan_id
  where p.group_id = v_member.group_id
    and p.status = 'active'
    and plan_obligation_amount(p.id, v_member.id) is not null
    and (p_include_past_periods or c.status = 'open')
  on conflict (cycle_id, member_id) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke execute on function issue_member_obligations(uuid, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Phone is required when an admin records a member
--
-- A record with no phone can never be claimed by the person it describes:
-- linking matches on a verified number and nothing else, so a blank one
-- guarantees a duplicate the moment they sign up. It is also how they will be
-- texted. `add_member` now insists on it.
-- ---------------------------------------------------------------------------

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
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_e164 text;
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can add members';
  end if;

  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Enter the member''s name';
  end if;

  if p_role = 'owner' and not has_group_role(p_group_id, 'owner') then
    raise exception 'Only the owner can appoint another owner';
  end if;

  if v_phone is null then
    raise exception
      'A phone number is required. It is how this member signs in and finds their own record.';
  end if;

  v_e164 := normalise_gh_phone(v_phone);
  if v_e164 is null then
    raise exception 'That is not a Ghana mobile number. Enter it like 024 123 4567.';
  end if;

  -- Two records with one number in one group can never be told apart, so
  -- linking refuses both. Catching it here means it never gets created.
  --
  -- `pending` is deliberately excluded. Someone waiting at the door is not yet
  -- a member, and an admin recording them properly while their request sits
  -- there is exactly the case `approve_join_request` merges. Counting it here
  -- would block that and make the merge unreachable.
  if exists (
    select 1 from group_members
    where group_id = p_group_id
      and phone_e164 = v_e164
      and status not in ('left', 'pending')
  ) then
    raise exception 'Someone in this group already has that number.';
  end if;

  insert into group_members (group_id, user_id, full_name, phone, role, status)
  values (p_group_id, null, trim(p_full_name), v_phone, p_role, 'active')
  returning * into v_member;

  perform issue_member_obligations(v_member.id, p_include_past_periods);

  return v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claiming: the status filter that was missing
-- ---------------------------------------------------------------------------

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

    if v_candidates > 1 then
      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (r_group.group_id, null, v_user, v_phone, 'ambiguous', null)
      on conflict do nothing;
      continue;
    end if;

    -- Only a LIVE membership blocks the claim. Without the status filter a
    -- duplicate an admin had already marked `left` kept its user_id and
    -- permanently blocked the real record — which made the one obvious repair
    -- for a duplicate do nothing at all.
    if exists (
      select 1 from group_members
      where group_id = r_group.group_id
        and user_id = v_user
        and status <> 'left'
    ) then
      continue;
    end if;

    -- A `left` row still holds the uid and would break unique (group_id,
    -- user_id) on the claim below, so release it first. The row itself stays:
    -- it may carry payment history, and dropping that to tidy up would be
    -- exactly the kind of silent loss this project refuses everywhere else.
    update group_members
       set user_id = null
     where group_id = r_group.group_id
       and user_id = v_user
       and status = 'left';

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

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------

create or replace function join_group(p_join_code text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups;
  v_existing group_members;
  v_phone text;
  v_profile_phone text;
  v_candidates int;
  v_member group_members;
  v_name text;
  v_status member_status;
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

  -- A code is an invitation, not a standing door. This holds money.
  if v_group.join_code_expires_at is not null
     and v_group.join_code_expires_at < now() then
    raise exception
      'That invite code has expired. Ask the group for a new one.';
  end if;

  select * into v_existing
  from group_members
  where group_id = v_group.id and user_id = v_user_id;

  if v_existing.id is not null then
    if v_existing.status = 'pending' then
      raise exception 'You have already asked to join this group. An admin still has to approve it.';
    end if;

    -- Re-joining after leaving reactivates the original membership, so the
    -- member keeps their contribution history.
    if v_existing.status <> 'active' then
      update group_members set status = 'active' where id = v_existing.id;
      perform issue_member_obligations(v_existing.id, false);
    end if;
    return v_group;
  end if;

  v_phone := current_verified_phone();

  -- Adopt the record an admin already made for this number. Approval is not
  -- asked for here on purpose: an admin who typed this person into the group
  -- has already decided they belong in it, and asking twice would be the
  -- confusing, expensive version of this flow.
  if v_phone is not null then
    select count(*) into v_candidates
    from group_members
    where group_id = v_group.id
      and phone_e164 = v_phone
      and user_id is null
      and status <> 'left';

    if v_candidates > 1 then
      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (v_group.id, null, v_user_id, v_phone, 'ambiguous', null)
      on conflict do nothing;

      raise exception
        'There are two member records with your number in this group. Ask an admin to remove the duplicate, then try again.';
    end if;

    if v_candidates = 1 then
      update group_members
      set user_id = v_user_id,
          status = case when status in ('invited', 'pending') then 'active'::member_status else status end
      where group_id = v_group.id
        and phone_e164 = v_phone
        and user_id is null
        and status <> 'left'
      returning * into v_member;

      insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
      values (v_group.id, v_member.id, v_user_id, v_phone, 'linked', v_member.full_name);

      perform issue_member_obligations(v_member.id, false);
      return v_group;
    end if;
  end if;

  -- Nobody was expecting them. This is a request unless the group has said
  -- otherwise.
  select coalesce(nullif(trim(full_name), ''), 'Member'), phone
    into v_name, v_profile_phone
  from profiles
  where id = v_user_id;

  v_status := case when v_group.join_requires_approval then 'pending' else 'active' end::member_status;

  -- The VERIFIED number wins over whatever the profile happens to hold: it is
  -- the one an admin will match against, and the one the merge on approval
  -- keys off. `v_phone` is still the verified value here — the profile read
  -- above deliberately lands in its own variable.
  insert into group_members (group_id, user_id, full_name, phone, role, status)
  values (
    v_group.id, v_user_id, coalesce(v_name, 'Member'),
    coalesce(v_phone, v_profile_phone), 'member', v_status
  )
  returning * into v_member;

  -- The fix for gap 1: a member who joins is billed for the open period exactly
  -- as one an admin adds is. A no-op while pending.
  perform issue_member_obligations(v_member.id, false);

  return v_group;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approving
-- ---------------------------------------------------------------------------

/**
 * Lets someone in, and folds them into the record an admin may have created for
 * them in the meantime.
 *
 * The merge is why this is not just an UPDATE. If an admin recorded
 * "Abraham Addae" with the same number after the request came in, activating
 * the request would leave the group with two of him. The pending row is brand
 * new and carries no history, so the safe direction is to discard it and hand
 * its account to the established record.
 */
create function approve_join_request(p_member_id uuid, p_include_past_periods boolean default false)
returns group_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending group_members;
  v_target group_members;
begin
  select * into v_pending from group_members where id = p_member_id;
  if v_pending.id is null then
    raise exception 'That request no longer exists';
  end if;

  if not has_group_role(v_pending.group_id, 'admin') then
    raise exception 'Only an admin or owner can approve a request';
  end if;

  if v_pending.status <> 'pending' then
    raise exception 'That request has already been dealt with';
  end if;

  if v_pending.phone_e164 is not null then
    select * into v_target
    from group_members
    where group_id = v_pending.group_id
      and phone_e164 = v_pending.phone_e164
      and user_id is null
      and status <> 'left'
      and id <> v_pending.id
    limit 1;
  end if;

  if v_target.id is not null then
    delete from group_members where id = v_pending.id;

    update group_members
       set user_id = v_pending.user_id,
           status  = 'active'
     where id = v_target.id
    returning * into v_target;

    insert into member_link_events (group_id, member_id, user_id, phone_e164, kind, member_name)
    values (v_target.group_id, v_target.id, v_target.user_id, v_target.phone_e164, 'linked', v_target.full_name);

    perform issue_member_obligations(v_target.id, p_include_past_periods);
    return v_target;
  end if;

  update group_members
     set status = 'active'
   where id = v_pending.id
  returning * into v_pending;

  perform issue_member_obligations(v_pending.id, p_include_past_periods);
  return v_pending;
end;
$$;

/** Turns someone away. The row goes, so they may ask again later. */
create function decline_join_request(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending group_members;
begin
  select * into v_pending from group_members where id = p_member_id;
  if v_pending.id is null then
    raise exception 'That request no longer exists';
  end if;

  if not has_group_role(v_pending.group_id, 'admin') then
    raise exception 'Only an admin or owner can decline a request';
  end if;

  if v_pending.status <> 'pending' then
    raise exception 'That request has already been dealt with';
  end if;

  -- Deleted rather than kept as `left`: nothing has happened yet, and a
  -- tombstone would block them from ever asking again.
  delete from group_members where id = v_pending.id;
end;
$$;

grant execute on function approve_join_request(uuid, boolean) to authenticated;
grant execute on function decline_join_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Codes
-- ---------------------------------------------------------------------------

create function regenerate_join_code(p_group_id uuid, p_days int default null)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
  v_days int := coalesce(p_days, 14);
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can change the invite code';
  end if;

  if v_days < 1 or v_days > 365 then
    raise exception 'Choose between 1 and 365 days';
  end if;

  update groups
     set join_code = gen_join_code(),
         join_code_expires_at = now() + make_interval(days => v_days)
   where id = p_group_id
  returning * into v_group;

  return v_group;
end;
$$;

create function set_join_policy(p_group_id uuid, p_requires_approval boolean)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups;
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can change how people join';
  end if;

  update groups
     set join_requires_approval = coalesce(p_requires_approval, true)
   where id = p_group_id
  returning * into v_group;

  return v_group;
end;
$$;

grant execute on function regenerate_join_code(uuid, int) to authenticated;
grant execute on function set_join_policy(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Keeping profiles.phone true
--
-- `handle_new_user` copies the phone across, but only ON INSERT. An email user
-- who adds a number later confirms it against auth.users and `profiles.phone`
-- stays NULL forever — so the members list and the profile screen would keep
-- showing no number for someone who plainly has one.
-- ---------------------------------------------------------------------------

create function sync_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only a CONFIRMED number is worth recording. An unconfirmed one is a string
  -- somebody typed, which is the same rule current_verified_phone() applies.
  if new.phone is distinct from old.phone
     or new.phone_confirmed_at is distinct from old.phone_confirmed_at then
    update public.profiles
       set phone = case when new.phone_confirmed_at is not null then new.phone end
     where id = new.id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_phone_changed
  after update on auth.users
  for each row execute function sync_profile_phone();

-- ---------------------------------------------------------------------------
-- Seeing your own request
--
-- `is_group_member()` requires an ACTIVE membership, so a pending person can
-- see neither the group nor their own row — correct for the group's money, and
-- useless for telling them what is happening. These two give them exactly
-- their own status and nothing else.
-- ---------------------------------------------------------------------------

create policy group_members_select_self on group_members
  for select using (user_id = auth.uid());

create function my_join_requests()
returns table (member_id uuid, group_id uuid, group_name text, requested_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, g.id, g.name, m.created_at
  from group_members m
  join groups g on g.id = m.group_id
  where m.user_id = auth.uid()
    and m.status = 'pending'
  order by m.created_at desc;
$$;

grant execute on function my_join_requests() to authenticated;

/** What an admin acts on: who is waiting, and since when. */
create view pending_join_requests
with (security_invoker = true)
as
select
  m.id          as member_id,
  m.group_id,
  m.full_name,
  m.phone,
  m.phone_e164,
  m.created_at  as requested_at,
  -- Names the record this request would be folded into on approval, so an
  -- admin can see the merge coming rather than discover it afterwards.
  (
    select t.full_name
    from group_members t
    where t.group_id = m.group_id
      and t.phone_e164 = m.phone_e164
      and t.user_id is null
      and t.status <> 'left'
      and t.id <> m.id
    limit 1
  ) as merges_into
from group_members m
where m.status = 'pending';

comment on view pending_join_requests is
  'Pending join requests. RLS on group_members restricts this to groups the '
  'caller can already read, and the screen is admin-only.';
