-- Profiles were half-built: the table, the `handle_new_user` trigger and the
-- self-update policy all existed, but nothing in the app ever wrote to them.
--
-- Email sign-up passes `full_name` through `raw_user_meta_data`, so those users
-- were fine. **Phone sign-up passes nothing**, so `profiles.full_name` stayed
-- `''` — and `create_group` / `join_group` both fall back to a literal 'Owner'
-- or 'Member' when it is blank. That is why a phone user's name reads as
-- "Member" on every screen in the group.
--
-- This adds the two things the app needs to fix that: a gated way to set your
-- own name, and somewhere to put a profile picture.

-- ---------------------------------------------------------------------------
-- Your name
-- ---------------------------------------------------------------------------

/**
 * Sets the signed-in user's own name.
 *
 * It also repairs `group_members.full_name`, but ONLY where that row still
 * holds a placeholder this app wrote itself ('Owner', 'Member') or nothing at
 * all. A name a treasurer typed is left exactly as it is: they entered it so
 * the group would recognise the person in a list, which is the same reason
 * `phone` is never overwritten by normalisation. Changing your own profile name
 * is not a licence to rewrite what a group calls you.
 *
 * SECURITY DEFINER only to reach `group_members` rows across every group at
 * once; the `user_id = auth.uid()` filter is what limits it to your own.
 */
create function set_my_name(p_full_name text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_profile profiles;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to set your name';
  end if;

  if v_name is null then
    raise exception 'Enter your name';
  end if;

  if length(v_name) > 80 then
    raise exception 'That name is too long';
  end if;

  update profiles
     set full_name = v_name
   where id = auth.uid()
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Profile not found';
  end if;

  update group_members
     set full_name = v_name
   where user_id = auth.uid()
     and coalesce(nullif(trim(full_name), ''), 'Member') in ('Owner', 'Member');

  return v_profile;
end;
$$;

grant execute on function set_my_name(text) to authenticated;

/**
 * Points the profile at an uploaded avatar. Kept as an RPC rather than a direct
 * update so the app has one place to call and the column cannot drift.
 */
create function set_my_avatar(p_avatar_url text)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to change your picture';
  end if;

  update profiles
     set avatar_url = nullif(trim(coalesce(p_avatar_url, '')), '')
   where id = auth.uid()
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'Profile not found';
  end if;

  return v_profile;
end;
$$;

grant execute on function set_my_avatar(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Seeing each other's names and faces
--
-- `profiles_select_self` limits SELECT to your own row, which is right for a
-- phone number but leaves no way to show a member's picture beside their name.
-- This adds exactly one more case: someone you share a group with.
-- ---------------------------------------------------------------------------

create policy profiles_select_group_members on profiles
  for select using (
    exists (
      select 1
        from group_members mine
        join group_members theirs on theirs.group_id = mine.group_id
       where mine.user_id = auth.uid()
         and mine.status = 'active'
         and theirs.user_id = profiles.id
         and theirs.status <> 'left'
    )
  );

-- ---------------------------------------------------------------------------
-- Avatar storage
--
-- Public-read, because an avatar is shown beside a name to everyone in the
-- group and signing every URL would buy nothing: the object path already
-- contains an unguessable uuid, and a face is not the secret here — the ledger
-- is, and that stays behind RLS.
--
-- The size limit is deliberately small. The app resizes to 512px and
-- re-encodes as JPEG before upload (~40-60 KB), so anything approaching 2 MB
-- means the client-side pipeline was bypassed and should fail.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Every object lives under a folder named for its owner's uid, so ownership is
-- a path check rather than a column. `storage.foldername()` returns the path
-- segments; the first is the uid.
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
