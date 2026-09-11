-- `plan_member_overrides` is step 2 of the four-step pricing chain inside
-- `plan_obligation_amount` — the most specific step short of the audience test
-- itself — and it has been reachable only by writing the table directly. Its
-- RLS policy (`plan_overrides_write`) lets any admin do exactly that.
--
-- That is the one gap where an admin can re-price an obligation that has
-- already been issued and paid against, which invariant 5 forbids everywhere
-- else. `set_plan_tag_amount` routes through `reprice_plan_obligations` and is
-- therefore refused once `plan_has_money`; a direct write to this table is
-- refused by nothing at all.
--
-- These two RPCs close it. The table keeps its policy — revoking it would
-- break nothing today but would be a silent behaviour change for anything
-- already reading it — but the app now has a gated path, and the RPCs are the
-- only thing the UI calls.

/**
 * Sets what one member pays on one contribution.
 *
 * A NULL amount means exempt: `plan_obligation_amount` returns NULL, and
 * `reissue_plan_obligations` then WAIVES their obligations rather than deleting
 * them. That distinction matters — a waived row stays out of
 * `obligation_balances` while keeping any payment already attached to it, so
 * exempting someone can never take money off the books.
 *
 * Refused for a susu (everyone in a rotation pays the same, or the pot stops
 * meaning anything) and for open giving (no set amount at all), matching
 * `set_plan_tag_amount`.
 */
create function set_plan_override(
  p_plan_id uuid,
  p_member_id uuid,
  p_amount bigint default null,
  p_reason text default null
)
returns plan_member_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
  v_row plan_member_overrides;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can change what a member pays';
  end if;

  if v_plan.kind = 'rotating' then
    raise exception 'Everyone in a susu contributes the same amount each period';
  end if;

  if v_plan.kind = 'open' then
    raise exception 'Open giving has no set amount — members give what they wish';
  end if;

  -- NULL is meaningful here (exempt), so only a negative number is wrong.
  if p_amount is not null and p_amount < 0 then
    raise exception 'Enter an amount of zero or more, or leave it blank to exempt them';
  end if;

  if not exists (
    select 1 from group_members
     where id = p_member_id
       and group_id = v_plan.group_id
  ) then
    raise exception 'That member belongs to another group';
  end if;

  insert into plan_member_overrides (plan_id, member_id, amount, reason)
  values (p_plan_id, p_member_id, p_amount, nullif(trim(coalesce(p_reason, '')), ''))
  on conflict (plan_id, member_id) do update
    set amount = excluded.amount,
        reason = excluded.reason
  returning * into v_row;

  -- Order matters. Reissue first: it settles whether this member is billed at
  -- all, adding a row back if they were exempt or waiving one if they now are.
  -- Reprice second, and only it is bound by `plan_has_money`, so an amount
  -- change on a plan that has taken money is a no-op rather than a rewrite.
  perform reissue_plan_obligations(p_plan_id);
  perform reprice_plan_obligations(p_plan_id);

  return v_row;
end;
$$;

/** Puts a member back on whatever the rest of the chain says they pay. */
create function clear_plan_override(p_plan_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan plans;
begin
  select * into v_plan from plans where id = p_plan_id;
  if v_plan.id is null then
    raise exception 'Plan not found';
  end if;

  if not has_group_role(v_plan.group_id, 'admin') then
    raise exception 'Only an admin or owner can change what a member pays';
  end if;

  delete from plan_member_overrides
   where plan_id = p_plan_id
     and member_id = p_member_id;

  perform reissue_plan_obligations(p_plan_id);
  perform reprice_plan_obligations(p_plan_id);
end;
$$;

grant execute on function set_plan_override(uuid, uuid, bigint, text) to authenticated;
grant execute on function clear_plan_override(uuid, uuid) to authenticated;
