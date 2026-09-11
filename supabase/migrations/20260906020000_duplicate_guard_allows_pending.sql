-- The duplicate-number guard added in the previous migration counted `pending`
-- rows, which made `approve_join_request`'s merge unreachable.
--
-- The sequence the merge exists for: someone asks to join (a pending row
-- carrying their verified number), and only then does an admin record them
-- properly as "Abraham Addae" with the same number. The guard refused that
-- second step, so the admin could not create the record the approval was
-- supposed to fold the request into.
--
-- A pending request is not a member. It is someone waiting at the door, and it
-- must not reserve their own phone number against them.
--
-- Found by the ledger check 'folds an approved request into the record an admin
-- already made', which could not get past its own setup.

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

  -- `pending` excluded: see the note at the top. `left` excluded because a
  -- departed member has no claim on the number either.
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
