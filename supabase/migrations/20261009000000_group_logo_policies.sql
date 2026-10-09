-- Group logos could never be uploaded.
--
-- The three write policies on the `group-logos` bucket test that the file sits
-- in a folder named after a group the caller administers:
--
--   where g.id::text = (storage.foldername(name))[1]
--
-- Inside that subquery `name` is ambiguous between `storage.objects.name` (the
-- file path, which is what was meant) and `groups.name`, and SQL resolves an
-- unqualified column to the NEAREST scope — the subquery's own table. Postgres
-- stored the policy as `storage.foldername(g.name)`: the folder of the group's
-- display name, which is never its id. Every upload was refused with "new row
-- violates row-level security policy", for every group, since the bucket was
-- created.
--
-- It was invisible because nothing fails at CREATE POLICY — the expression is
-- valid, only wrong — and no ledger check uploads a file. `pg_policies` shows
-- what was actually stored, which is how this was found.
--
-- The avatars policies are unaffected: they compare against `auth.uid()` with
-- no subquery, so there is no second `name` in scope.

drop policy if exists group_logos_insert on storage.objects;
drop policy if exists group_logos_update on storage.objects;
drop policy if exists group_logos_delete on storage.objects;

create policy group_logos_insert on storage.objects
  for insert with check (
    bucket_id = 'group-logos'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(objects.name))[1]
        and public.has_group_role(g.id, 'admin')
    )
  );

create policy group_logos_update on storage.objects
  for update using (
    bucket_id = 'group-logos'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(objects.name))[1]
        and public.has_group_role(g.id, 'admin')
    )
  );

create policy group_logos_delete on storage.objects
  for delete using (
    bucket_id = 'group-logos'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(objects.name))[1]
        and public.has_group_role(g.id, 'admin')
    )
  );
