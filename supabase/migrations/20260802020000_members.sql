-- Member management and per-member standing.

/**
 * Adds someone to the group.
 *
 * `user_id` stays NULL: most members never install Kobox, and the treasurer
 * records on their behalf. If that person later signs up and joins with the
 * group code, join_group creates a separate row — linking the two is a
 * deliberate admin action, not something we guess at from a phone number.
 *
 * Anyone added while a cycle is already open is issued that cycle's obligation
 * too. Without this a member added on the 20th silently owes nothing for the
 * month, and the group's collection rate quietly overstates itself.
 */
create function add_member(
  p_group_id uuid,
  p_full_name text,
  p_phone text default null,
  p_role member_role default 'member'
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
  select c.id, v_member.id, p.default_amount
  from cycles c
  join plans p on p.id = c.plan_id
  where p.group_id = p_group_id
    and p.status = 'active'
    and p.kind <> 'open'
    and c.status = 'open'
    and p.default_amount is not null
  on conflict (cycle_id, member_id) do nothing;

  return v_member;
end;
$$;

grant execute on function add_member(uuid, text, text, member_role) to authenticated;

-- What each member owes across every cycle. Derived, never stored.
create view member_standings
with (security_invoker = true)
as
select
  m.id                                                        as member_id,
  m.group_id,
  coalesce(b.total_due, 0)::bigint                            as total_due,
  coalesce(b.total_paid, 0)::bigint                           as total_paid,
  (coalesce(b.total_due, 0) - coalesce(b.total_paid, 0))::bigint as balance
from group_members m
left join (
  select
    member_id,
    sum(amount_due)  as total_due,
    sum(amount_paid) as total_paid
  from obligation_balances
  group by member_id
) b on b.member_id = m.id;
