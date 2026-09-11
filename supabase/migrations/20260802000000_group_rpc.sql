-- Atomic group creation and joining.
--
-- Creating a group is two inserts (the group, then its owner membership). Doing
-- that from the client is not atomic: a dropped connection between the two
-- leaves a group nobody can administer, and RLS would then block every attempt
-- to repair it. These functions make each flow a single transaction.

-- Human-friendly, unambiguous join codes. Excludes I, O, 0 and 1 so a code read
-- aloud over the phone or copied off a WhatsApp message cannot be mistyped.
create function gen_join_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  attempt int := 0;
begin
  loop
    candidate := 'KBX-';
    for _ in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from groups where join_code = candidate);

    attempt := attempt + 1;
    if attempt > 20 then
      raise exception 'Could not generate a unique join code';
    end if;
  end loop;

  return candidate;
end;
$$;

create function create_group(p_name text, p_currency text default 'GHS')
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_group groups;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Group name is required';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Owner')
    into v_name
  from profiles
  where id = v_user_id;

  insert into groups (name, join_code, currency, created_by)
  values (trim(p_name), gen_join_code(), upper(p_currency), v_user_id)
  returning * into v_group;

  insert into group_members (group_id, user_id, full_name, role, status)
  values (v_group.id, v_user_id, coalesce(v_name, 'Owner'), 'owner', 'active');

  return v_group;
end;
$$;

create function join_group(p_join_code text)
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

  select coalesce(nullif(trim(full_name), ''), 'Member')
    into v_name
  from profiles
  where id = v_user_id;

  insert into group_members (group_id, user_id, full_name, role, status)
  values (v_group.id, v_user_id, coalesce(v_name, 'Member'), 'member', 'active');

  return v_group;
end;
$$;

-- These are the only entry points; nothing else should call them.
revoke execute on function gen_join_code() from anon, authenticated;
grant execute on function create_group(text, text) to authenticated;
grant execute on function join_group(text) to authenticated;
