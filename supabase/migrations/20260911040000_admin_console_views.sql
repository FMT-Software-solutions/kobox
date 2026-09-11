-- What the FMT admin console expects to find in every app's database.
--
-- The console's dashboard counts, for each registered app, `organizations`,
-- the active ones, and `user_organizations` — the accounts that belong to one.
-- Kobox has `groups` and `group_members` instead, so the Kobox card read
-- "Some apps could not be reached — Kobox:" with an EMPTY message: those
-- counts are HEAD requests, which carry no response body, so the "relation
-- does not exist" error arrived with nothing in it.
--
-- Same answer as `organizations` (20260909040000): a view that speaks the
-- console's language over Kobox's own tables, rather than a second copy of
-- either, or Kobox-specific branches in a backend that is otherwise app-
-- agnostic. Service role only, like its sibling.

-- ---------------------------------------------------------------------------
-- user_organizations — the accounts in each group
--
-- Only memberships held by an ACCOUNT. Most of a Kobox group is people a
-- treasurer typed in who never installed the app; they are members of the
-- group but not users of the platform, and the console's "users" figure is
-- the latter.
-- ---------------------------------------------------------------------------

create or replace view user_organizations as
  select
    m.id,
    m.user_id,
    m.group_id               as organization_id,
    m.role::text             as role,
    (m.status = 'active')    as is_active,
    m.created_at
  from group_members m
  where m.user_id is not null;

comment on view user_organizations is
  'Compatibility shim for fmt-ss-backend''s admin console: accounts per group. '
  'Service role only.';

revoke all on user_organizations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- organizations — the columns the console's list also selects
--
-- Appended, never inserted: `create or replace view` may only add columns at
-- the end (HANDOFF gotcha). Kobox sells no app licences and runs no trials, so
-- `has_purchased` and `trial_end_date` are constants that say exactly that.
-- ---------------------------------------------------------------------------

create or replace view organizations as
  select
    g.id,
    g.name,
    owner.email                              as email,
    coalesce(owner.phone_e164, owner.phone)  as phone,
    true                                     as is_active,
    g.sms_sender_id,
    g.created_at,
    g.updated_at,
    false                                    as has_purchased,
    null::timestamptz                        as trial_end_date,
    g.currency
  from groups g
  left join lateral (
    select m.email, m.phone, m.phone_e164
    from group_members m
    where m.group_id = g.id
      and m.role = 'owner'
      and m.status = 'active'
    order by m.joined_at
    limit 1
  ) owner on true;

revoke all on organizations from anon, authenticated;
