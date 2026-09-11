-- Group settings: who the group is, what it looks like — and which of its
-- columns an admin may actually write.
--
-- ---------------------------------------------------------------------------
-- The hole this closes first
--
-- `groups_update` (init migration) lets any admin update ANY column. Two of
-- those columns were never an admin's to set:
--
--   * `sms_sender_id` — setting it directly skips the approval queue entirely.
--     An admin could make their group's texts arrive signed as a bank or a
--     network, which is precisely what sender-ID registration exists to stop.
--   * `currency` — every amount in the ledger is minor units with no currency
--     of its own. Changing GHS to USD silently relabels two years of
--     contributions as dollars.
--
-- `join_code`, `created_by` and `timezone` had the same exposure with smaller
-- consequences. Row-level security answers "which rows"; only column
-- privileges answer "which columns", and the two are easy to confuse (see the
-- print-calc-pro memory: RLS ≠ column security).
--
-- So table-level UPDATE is revoked and granted back per column. Every other
-- change to a group goes through a SECURITY DEFINER RPC, which runs as its
-- owner and is unaffected. `join_code_expires_at` stays writable: extending an
-- invite is already possible through `regenerate_join_code`, and the ledger
-- checks set a past expiry directly to test the refusal path.
-- ---------------------------------------------------------------------------

alter table groups
  add column if not exists description text,
  add column if not exists brand_colour text;

alter table groups
  drop constraint if exists groups_description_length,
  add constraint groups_description_length
    check (description is null or length(description) <= 280);

-- A named palette rather than free hex. Every preset has a dark-mode twin and a
-- foreground chosen for contrast; a free colour picker is how a group ends up
-- with white text on yellow buttons that nobody can read.
alter table groups
  drop constraint if exists groups_brand_colour_known,
  add constraint groups_brand_colour_known
    check (brand_colour is null or brand_colour in (
      'jade', 'ocean', 'indigo', 'plum', 'crimson', 'amber', 'slate'
    ));

-- The ceiling is the group's own, but a typo of 1,000,000 is not a ceiling.
alter table groups
  drop constraint if exists groups_sms_monthly_cap_range,
  add constraint groups_sms_monthly_cap_range
    check (sms_monthly_cap between 0 and 100000);

comment on column groups.description is 'Shown to members. At most 280 characters.';
comment on column groups.brand_colour is 'Named preset from src/lib/brand.ts. NULL means the Kobox default, jade.';

revoke update on groups from anon, authenticated;

grant update (
  name,
  description,
  logo_url,
  brand_colour,
  sms_enabled,
  sms_monthly_cap,
  join_code_expires_at
) on groups to authenticated;

-- ---------------------------------------------------------------------------
-- Group logos
--
-- Same shape as `avatars`: public read (the URL carries an unguessable path,
-- and a logo is not the secret — the ledger is), small size limit because the
-- app resizes before upload. Ownership is the FIRST folder of the path, which
-- is the group id, and only that group's admins may write under it.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-logos',
  'group-logos',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy group_logos_read on storage.objects
  for select using (bucket_id = 'group-logos');

create policy group_logos_insert on storage.objects
  for insert with check (
    bucket_id = 'group-logos'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(name))[1]
        and public.has_group_role(g.id, 'admin')
    )
  );

create policy group_logos_update on storage.objects
  for update using (
    bucket_id = 'group-logos'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(name))[1]
        and public.has_group_role(g.id, 'admin')
    )
  );

create policy group_logos_delete on storage.objects
  for delete using (
    bucket_id = 'group-logos'
    and exists (
      select 1 from public.groups g
      where g.id::text = (storage.foldername(name))[1]
        and public.has_group_role(g.id, 'admin')
    )
  );
