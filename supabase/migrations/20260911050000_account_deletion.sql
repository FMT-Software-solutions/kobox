-- Deleting your own account.
--
-- Google Play requires it for any app with sign-up, in the app AND on the web,
-- and it is the right thing to offer regardless. Until this migration it was
-- impossible in a way nobody would have noticed until they tried:
-- `groups.created_by` was NOT NULL with no ON DELETE rule, so deleting anybody
-- who had ever created a group failed on a foreign key.
--
-- What deleting an account means here, because a group ledger is not a social
-- network and "delete everything about me" has to be answered carefully:
--
--   * The ACCOUNT goes: the login, the profile and photo, registered devices,
--     notifications addressed to it, link notices. All of these already
--     cascade from auth.users.
--   * The GROUP'S RECORDS stay. A treasurer's entry "Ama paid ₵50 in March" is
--     the group's financial record, made by the group, and other people's
--     balances are computed from it. The member row is unlinked (user_id set
--     to NULL, which `group_members` already does) — it becomes exactly what it
--     is for a member who never installed the app. The group's admins can
--     remove it. The privacy policy says so in plain words.
--   * Groups where the leaving person is the ONLY account are deleted with
--     them. Nobody else can open those groups, so keeping them would keep data
--     nobody can reach, correct or remove.
--   * Groups they OWN that other people still use are a blocker, not a silent
--     casualty: deleting the only owner would strand everyone else in a group
--     nobody can administer. They are told which groups, and asked to make
--     someone else an owner or delete the group first.
--
-- The auth user itself is removed by the `delete-account` Edge Function with
-- the service role; `prepare_account_deletion` does everything that has to
-- happen AS the user first.

-- ---------------------------------------------------------------------------
-- The foreign key that made deletion impossible
-- ---------------------------------------------------------------------------

alter table groups alter column created_by drop not null;

alter table groups drop constraint if exists groups_created_by_fkey;
alter table groups
  add constraint groups_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

comment on column groups.created_by is
  'The account that created the group. NULL once that account is deleted; the group lives on.';

-- ---------------------------------------------------------------------------
-- What deleting would do — shown BEFORE anybody confirms
-- ---------------------------------------------------------------------------

create or replace function account_deletion_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_blocking jsonb;
  v_deleting jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in first';
  end if;

  -- Groups where this person is the only active owner. Co-owned groups are not
  -- listed at all: the other owner carries on and this person simply leaves.
  with sole as (
    select
      g.id,
      g.name,
      exists (
        select 1 from group_members o
        where o.group_id = g.id
          and o.status = 'active'
          and o.user_id is not null
          and o.user_id <> v_uid
      ) as others_use_it
    from groups g
    join group_members me
      on me.group_id = g.id
     and me.user_id = v_uid
     and me.status = 'active'
     and me.role = 'owner'
    where not exists (
      select 1 from group_members o
      where o.group_id = g.id
        and o.role = 'owner'
        and o.status = 'active'
        and o.user_id is not null
        and o.user_id <> v_uid
    )
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      filter (where others_use_it), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      filter (where not others_use_it), '[]'::jsonb)
  into v_blocking, v_deleting
  from sole;

  return jsonb_build_object('blocking', v_blocking, 'deleting', v_deleting);
end;
$$;

-- ---------------------------------------------------------------------------
-- Everything that must happen as the user, before the account is removed
--
-- Called by the Edge Function with the user's own token, so `auth.uid()` and
-- the owner check inside `delete_group_cascade` both see the real person.
--
-- If the Edge Function then fails to delete the auth user, the solo groups are
-- already gone and the account remains. That is safe to retry: a second run
-- finds nothing left to delete and goes straight to removing the account.
-- ---------------------------------------------------------------------------

create or replace function prepare_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_preview jsonb;
  v_names   text;
  r         record;
begin
  if v_uid is null then
    raise exception 'Sign in first';
  end if;

  v_preview := account_deletion_preview();

  if jsonb_array_length(v_preview -> 'blocking') > 0 then
    select string_agg(e ->> 'name', ', ')
      into v_names
      from jsonb_array_elements(v_preview -> 'blocking') e;

    raise exception 'You are the only owner of %. Make someone else an owner, or delete the group, first.',
      v_names;
  end if;

  for r in
    select (e ->> 'id')::uuid as id
    from jsonb_array_elements(v_preview -> 'deleting') e
  loop
    perform delete_group_cascade(r.id);
  end loop;

  -- A join request with nobody behind it is noise in an admin's queue.
  update group_members
     set status = 'left'
   where user_id = v_uid
     and status = 'pending';

  return v_preview;
end;
$$;

-- Naming every grantee (HANDOFF: two revokes, and neither alone works). Both
-- act only on the caller's own account, so authenticated may call them.
revoke execute on function account_deletion_preview() from public, anon;
revoke execute on function prepare_account_deletion() from public, anon;
grant execute on function account_deletion_preview() to authenticated;
grant execute on function prepare_account_deletion() to authenticated;
