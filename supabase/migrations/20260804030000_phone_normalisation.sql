-- Canonical Ghana phone numbers, for matching a phone login to a member record.
--
-- A treasurer types "024 123 4567". The member later signs in and Supabase hands
-- us "+233241234567". Those are the same person and must compare equal, or the
-- member gets a second empty membership instead of their own history.
--
-- `phone` is NOT overwritten. It keeps whatever was typed — that is what the
-- treasurer recognises in a list, and rewriting a column of real records to suit
-- a matching rule is not a trade worth making. `phone_e164` is added alongside
-- as the match key, maintained by a trigger so it can never drift from `phone`.
--
-- NOTE: this rule now exists twice — here and in `src/lib/phone.ts`. That is the
-- shape of mistake that has already cost this project three times (the amount
-- resolution rule). It is unavoidable: SQL cannot call the TypeScript, and input
-- validation has to happen in the app. The mitigation is a ledger check that
-- feeds the SAME corpus of inputs to both and asserts they agree. If you change
-- one, change the other and run `npm run test:ledger`.

/**
 * Ghana mobile number → `+233XXXXXXXXX`, or NULL when it is not one.
 *
 * Accepts 024 123 4567, 0241234567, 241234567, +233241234567, 233241234567,
 * 00233241234567, and the very common +233 024... (country code pasted in front
 * of the local form — the trunk zero is dropped rather than the number refused).
 *
 * Mobile only: subscriber numbers start 2 or 5. Landlines start 3 and cannot
 * receive an SMS, so they are not an identity we can verify.
 */
create function normalise_gh_phone(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  v_digits text;
begin
  if p_phone is null then
    return null;
  end if;

  v_digits := regexp_replace(p_phone, '\D', '', 'g');

  if v_digits = '' then
    return null;
  end if;

  -- International prefix spelled out.
  if left(v_digits, 2) = '00' then
    v_digits := substr(v_digits, 3);
  end if;

  if left(v_digits, 3) = '233' then
    v_digits := substr(v_digits, 4);
    -- "+233 024 123 4567" — the trunk zero is never part of the E.164 form.
    if length(v_digits) = 10 and left(v_digits, 1) = '0' then
      v_digits := substr(v_digits, 2);
    end if;
  elsif left(v_digits, 1) = '0' then
    v_digits := substr(v_digits, 2);
  elsif length(v_digits) > 9 then
    -- Long and not Ghanaian: a foreign number, not a typo we should salvage.
    return null;
  end if;

  if length(v_digits) <> 9 then
    return null;
  end if;

  if left(v_digits, 1) not in ('2', '5') then
    return null;
  end if;

  return '+233' || v_digits;
end;
$$;

alter table group_members add column phone_e164 text;

-- One rule, one place: every write goes through the same function, so the two
-- columns cannot drift no matter which RPC or backfill did the writing.
create function sync_member_phone_e164()
returns trigger
language plpgsql
as $$
begin
  new.phone_e164 := normalise_gh_phone(new.phone);
  return new;
end;
$$;

create trigger group_members_phone_e164
  before insert or update of phone on group_members
  for each row execute function sync_member_phone_e164();

-- Backfill. `phone` is untouched; unparseable values simply leave phone_e164
-- NULL, which reads correctly as "no verified number to match against".
update group_members
set phone = phone
where phone is not null;

create index group_members_phone_e164_idx on group_members (phone_e164)
  where phone_e164 is not null;

/**
 * The same number twice in one group is a data error, not a person with two
 * memberships — and at sign-in it is unresolvable, because there is no way to
 * tell which record the caller meant. Flagged here so linking can refuse it.
 *
 * Deliberately NOT a unique constraint: existing groups may already contain
 * duplicates, and failing a migration (or a treasurer's save) is a worse outcome
 * than reporting it. Linking treats an ambiguous match as "link nothing".
 */
create view duplicate_member_phones
with (security_invoker = true)
as
select
  m.group_id,
  m.phone_e164,
  count(*)::int        as member_count,
  array_agg(m.id)      as member_ids,
  array_agg(m.full_name order by m.full_name) as member_names
from group_members m
where m.phone_e164 is not null
  and m.status <> 'left'
group by m.group_id, m.phone_e164
having count(*) > 1;

-- add_member gains nothing new to do: the trigger normalises whatever it wrote.
-- It is replaced only to reject a number the app could never text, so the error
-- surfaces at the point of entry rather than months later at the member's first
-- sign-in attempt.
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

  -- A phone number is how this member will one day sign in and see their own
  -- balance, so a number we can never text is worth catching now. Blank stays
  -- allowed: plenty of members are recorded without one.
  if v_phone is not null and normalise_gh_phone(v_phone) is null then
    raise exception
      'That is not a Ghana mobile number. Enter it like 024 123 4567, or leave it blank.';
  end if;

  insert into group_members (group_id, user_id, full_name, phone, role, status)
  values (p_group_id, null, trim(p_full_name), v_phone, p_role, 'active')
  returning * into v_member;

  insert into obligations (cycle_id, member_id, amount_due)
  select c.id, v_member.id, plan_obligation_amount(p.id, v_member.id)
  from cycles c
  join plans p on p.id = c.plan_id
  where p.group_id = p_group_id
    and p.status = 'active'
    and plan_obligation_amount(p.id, v_member.id) is not null
    and (p_include_past_periods or c.status = 'open')
  on conflict (cycle_id, member_id) do nothing;

  return v_member;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.proname, count(*) as overloads
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_plan', 'update_plan', 'add_member', 'record_payment',
        'create_group', 'join_group', 'generate_cycle', 'generate_due_cycles',
        'apply_credit', 'allocate_payment', 'confirm_payment', 'reverse_payment',
        'assign_rotation', 'append_to_rotation', 'replace_rotation_member',
        'record_payout', 'reverse_payout', 'plan_obligation_amount',
        'reissue_plan_obligations', 'reissue_plans_for_tag', 'create_tag',
        'rename_tag', 'delete_tag', 'set_tag_members', 'set_member_tags',
        'set_plan_audience', 'set_plan_tag_amount', 'clear_plan_tag_amount',
        'reprice_plan_obligations', 'normalise_gh_phone'
      )
    group by p.proname
    having count(*) > 1
  loop
    raise exception
      'Function %() still has % overloads — PostgREST cannot choose between them',
      r.proname, r.overloads;
  end loop;
end;
$$;
