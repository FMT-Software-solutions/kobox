-- Deleting a group has never actually worked.
--
-- `groups_delete` has always permitted an owner to delete their own group, and
-- `groups` cascades to almost everything. But two things block it, and both
-- only bite once a group has seen real money — which is why it looked fine:
--
--   1. `payments.member_id` is ON DELETE RESTRICT. RESTRICT is checked
--      immediately and cannot be deferred, so the cascade into `group_members`
--      aborts the moment one payment exists.
--   2. The append-only triggers refuse a DELETE on any confirmed/reversed
--      payment or approved expense. A cascading delete still fires row
--      triggers on the child table, so even removing (1) would not help.
--
-- The visible cost: `scripts/ledger-check.ts` has been calling `.delete()` on
-- its scratch groups since day one and discarding the error. 609 `Ledger — …`
-- groups are currently stranded in the project.
--
-- This adds the one path that can clear them, and narrows the trigger bypass
-- so tightly that it cannot become a way to rewrite history.

-- ---------------------------------------------------------------------------
-- The bypass
--
-- Both triggers gain a single early exit, and it demands two things at once:
--
--   * a transaction-local GUC naming the exact group being purged, and
--   * `current_user` being the OWNER of the table the trigger guards.
--
-- The second condition is what makes this safe. PostgREST executes as
-- `authenticated`; only the body of a SECURITY DEFINER function owned by the
-- table owner runs as that owner. A client can trivially set the GUC itself —
-- `set_config` is not privileged — but it can never satisfy the second half,
-- so an admin issuing a raw DELETE on `payments` is refused exactly as before.
-- The ledger check that asserts this ("refuses to delete a confirmed payment")
-- still passes, and is the regression test for it.
--
-- Note this grants no authority that did not already exist: `groups_delete`
-- already says an owner may delete their group. This only makes the permitted
-- action possible instead of silently failing.
-- ---------------------------------------------------------------------------

create or replace function purging_group(p_group_id uuid, p_table text)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('kobox.purging_group', true), '') = p_group_id::text
     and current_user = (
       select pg_get_userbyid(c.relowner)
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = p_table
     );
$$;

comment on function purging_group(uuid, text) is
  'True only inside delete_group_cascade for this exact group. The current_user '
  'test is the security boundary: a client is always `authenticated` and can '
  'never match the table owner, however it sets the GUC.';

create or replace function protect_confirmed_payments()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Whole-group purge by the owner. See purging_group().
    if purging_group(old.group_id, 'payments') then
      return old;
    end if;
    if old.status in ('confirmed', 'reversed') then
      raise exception 'Confirmed payments cannot be deleted. Insert a reversing payment instead.';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' and new.status not in ('confirmed', 'reversed') then
    raise exception 'A confirmed payment may only move to reversed.';
  end if;

  if old.status in ('confirmed', 'reversed') then
    if new.amount    is distinct from old.amount
    or new.member_id is distinct from old.member_id
    or new.method    is distinct from old.method
    or new.paid_at   is distinct from old.paid_at then
      raise exception 'Confirmed payment details are immutable. Insert a reversing payment instead.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function protect_approved_expenses()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Whole-group purge by the owner. See purging_group().
    if purging_group(old.group_id, 'expenses') then
      return old;
    end if;
    if old.status = 'approved' then
      raise exception 'Approved expenses cannot be deleted. Void it instead.';
    end if;
    return old;
  end if;

  if old.status = 'approved' then
    if new.amount   is distinct from old.amount
    or new.title    is distinct from old.title
    or new.spent_at is distinct from old.spent_at
    or new.group_id is distinct from old.group_id then
      raise exception 'An approved expense cannot be altered. Void it and record a new one.';
    end if;

    if new.status not in ('approved', 'rejected') then
      raise exception 'An approved expense may only be voided.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The cascade
--
-- Deliberately explicit rather than leaning on ON DELETE CASCADE. The order
-- below is the FK order, and writing it out means a future table that
-- references `group_members` fails loudly here instead of silently
-- resurrecting the stranded-group bug.
-- ---------------------------------------------------------------------------

create or replace function delete_group_cascade(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_group_role(p_group_id, 'owner') then
    raise exception 'Only the group owner may delete the group.';
  end if;

  -- Transaction-local; released on commit. Paired with the current_user test
  -- inside purging_group(), which is the half a client cannot forge.
  perform set_config('kobox.purging_group', p_group_id::text, true);

  delete from allocations a
   using payments p
   where a.payment_id = p.id
     and p.group_id = p_group_id;

  -- One statement, so the self-reference `reverses_payment_id` (NO ACTION, and
  -- therefore checked at end of statement) sees no orphan.
  delete from payments where group_id = p_group_id;
  delete from expenses where group_id = p_group_id;

  delete from rotation_slots rs
   using plans pl
   where rs.plan_id = pl.id
     and pl.group_id = p_group_id;

  delete from obligations o
   using cycles c, plans pl
   where o.cycle_id = c.id
     and c.plan_id = pl.id
     and pl.group_id = p_group_id;

  delete from cycles c
   using plans pl
   where c.plan_id = pl.id
     and pl.group_id = p_group_id;

  delete from plan_member_overrides pmo
   using plans pl
   where pmo.plan_id = pl.id
     and pl.group_id = p_group_id;

  delete from plan_tag_amounts pta
   using plans pl
   where pta.plan_id = pl.id
     and pl.group_id = p_group_id;

  -- Before group_members: plans.created_by references it.
  delete from plans where group_id = p_group_id;

  delete from member_tags mt
   using tags t
   where mt.tag_id = t.id
     and t.group_id = p_group_id;

  delete from tags where group_id = p_group_id;
  delete from member_link_events where group_id = p_group_id;
  delete from group_members where group_id = p_group_id;
  delete from groups where id = p_group_id;
end;
$$;

comment on function delete_group_cascade(uuid) is
  'Owner-only permanent deletion of a group and its entire ledger. The only '
  'path that can remove a group which has recorded money.';

revoke all on function delete_group_cascade(uuid) from public;
grant execute on function delete_group_cascade(uuid) to authenticated;
