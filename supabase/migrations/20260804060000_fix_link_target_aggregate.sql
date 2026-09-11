-- link_target_for_phone() used min(m.id) to pick the single match. Postgres has
-- no min() for uuid, so the function raised `function min(uuid) does not exist`
-- the moment it actually looked at a candidate row.
--
-- It went unnoticed on first write because every path that avoids the query —
-- an unparseable number, an account with no verified phone — returns early and
-- never reaches the aggregate. Only a real match reached it. The ledger checks
-- caught it on their first run, which is precisely what they are for.
--
-- Rewritten with a CTE: count the matches once, and select the row only when
-- there is exactly one. LIMIT 1 is belt and braces — the CASE already guards it,
-- but a scalar subquery that could ever see two rows is a trap for the next edit.

create or replace function link_target_for_phone(p_group_id uuid, p_phone text)
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
  with matches as (
    select m.id, m.full_name
    from group_members m
    where m.group_id = p_group_id
      and m.phone_e164 = v_phone
      and m.user_id is null
      and m.status <> 'left'
  )
  select
    (select count(*)::int from matches),
    -- Only meaningful when exactly one matched; NULL is the caller's signal to
    -- stop, so an ambiguous group can never be resolved by accident.
    case when (select count(*) from matches) = 1
      then (select id from matches limit 1) end,
    case when (select count(*) from matches) = 1
      then (select full_name from matches limit 1) end;
end;
$$;
