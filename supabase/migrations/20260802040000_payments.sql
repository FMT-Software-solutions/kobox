-- Recording and confirming payments.
--
-- Money in is two facts: that it arrived, and what it settles. Doing those as
-- separate client calls risks a payment recorded but unallocated — the group
-- balance moves while the member still shows as owing. Both happen here, in one
-- transaction, or neither does.

/**
 * Applies a confirmed payment to the member's outstanding obligations,
 * oldest first — which is what a treasurer does on paper, and what makes
 * "how many months behind is this person" answerable.
 *
 * Any surplus is recorded as an allocation with no obligation: money held in
 * credit against future cycles. Allocations therefore always sum to exactly the
 * payment amount, so reconciliation never has to explain a difference.
 */
create function allocate_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_remaining bigint;
  v_take bigint;
  r record;
begin
  select * into v_payment from payments where id = p_payment_id;
  if v_payment.id is null then
    raise exception 'Payment not found';
  end if;

  if v_payment.status <> 'confirmed' then
    return; -- Only confirmed money settles anything.
  end if;

  -- Re-allocating would double-count; allocations are written once.
  if exists (select 1 from allocations where payment_id = p_payment_id) then
    return;
  end if;

  v_remaining := v_payment.amount;

  for r in
    select b.obligation_id, b.balance, c.plan_id
    from obligation_balances b
    join cycles c on c.id = b.cycle_id
    join plans p on p.id = c.plan_id
    where b.member_id = v_payment.member_id
      and p.group_id = v_payment.group_id
      and b.balance > 0
    order by c.due_date, c.period_start
  loop
    exit when v_remaining <= 0;

    v_take := least(v_remaining, r.balance);

    insert into allocations (payment_id, obligation_id, plan_id, amount)
    values (p_payment_id, r.obligation_id, r.plan_id, v_take);

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    insert into allocations (payment_id, obligation_id, plan_id, amount)
    values (p_payment_id, null, null, v_remaining);
  end if;
end;
$$;

/**
 * Records money received.
 *
 * A treasurer records for anyone and it counts immediately. An ordinary member
 * may only record their own, and it lands as `pending` for a treasurer to
 * confirm — otherwise anyone could inflate their own contribution record.
 */
create function record_payment(
  p_group_id uuid,
  p_member_id uuid,
  p_amount bigint,
  p_method payment_method,
  p_paid_at timestamptz default now(),
  p_reference text default null,
  p_note text default null
)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_is_treasurer boolean;
  v_status payment_status;
  v_payment payments;
begin
  v_actor_id := current_member_id(p_group_id);
  if v_actor_id is null then
    raise exception 'Not a member of this group';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;

  if not exists (
    select 1 from group_members
    where id = p_member_id and group_id = p_group_id and status = 'active'
  ) then
    raise exception 'That member is not in this group';
  end if;

  v_is_treasurer := has_group_role(p_group_id, 'treasurer');

  if not v_is_treasurer and p_member_id <> v_actor_id then
    raise exception 'You can only record your own payments';
  end if;

  if p_paid_at > now() + interval '1 day' then
    raise exception 'A payment cannot be dated in the future';
  end if;

  v_status := case when v_is_treasurer then 'confirmed' else 'pending' end;

  insert into payments (
    group_id, member_id, amount, method, status,
    paid_at, reference, note, recorded_by, confirmed_by
  )
  values (
    p_group_id, p_member_id, p_amount, p_method, v_status,
    p_paid_at, nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    v_actor_id,
    case when v_is_treasurer then v_actor_id else null end
  )
  returning * into v_payment;

  perform allocate_payment(v_payment.id);

  return v_payment;
end;
$$;

/** A treasurer approving a payment a member recorded for themselves. */
create function confirm_payment(p_payment_id uuid)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_actor_id uuid;
begin
  select * into v_payment from payments where id = p_payment_id;
  if v_payment.id is null then
    raise exception 'Payment not found';
  end if;

  if not has_group_role(v_payment.group_id, 'treasurer') then
    raise exception 'Only a treasurer or above can confirm a payment';
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Only a pending payment can be confirmed';
  end if;

  v_actor_id := current_member_id(v_payment.group_id);

  update payments
  set status = 'confirmed', confirmed_by = v_actor_id
  where id = p_payment_id
  returning * into v_payment;

  perform allocate_payment(p_payment_id);

  return v_payment;
end;
$$;

/**
 * Undoes a confirmed payment by writing a reversing entry. The original row is
 * never touched — the append-only trigger would refuse anyway. The reversal
 * carries a negative amount so the group's totals move back, and both rows stay
 * visible so the correction is part of the record rather than hidden.
 */
create function reverse_payment(p_payment_id uuid, p_reason text)
returns payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original payments;
  v_actor_id uuid;
  v_reversal payments;
begin
  select * into v_original from payments where id = p_payment_id;
  if v_original.id is null then
    raise exception 'Payment not found';
  end if;

  if not has_group_role(v_original.group_id, 'admin') then
    raise exception 'Only an admin or owner can reverse a payment';
  end if;

  if v_original.status <> 'confirmed' then
    raise exception 'Only a confirmed payment can be reversed';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason for the reversal';
  end if;

  v_actor_id := current_member_id(v_original.group_id);

  insert into payments (
    group_id, member_id, amount, method, status,
    paid_at, note, recorded_by, confirmed_by, reverses_payment_id
  )
  values (
    v_original.group_id, v_original.member_id, -v_original.amount, v_original.method, 'confirmed',
    now(), trim(p_reason), v_actor_id, v_actor_id, v_original.id
  )
  returning * into v_reversal;

  -- Release the original's allocations so the obligations it settled become
  -- outstanding again.
  delete from allocations where payment_id = v_original.id;

  update payments set status = 'reversed' where id = v_original.id;

  return v_reversal;
end;
$$;

grant execute on function record_payment(uuid, uuid, bigint, payment_method, timestamptz, text, text) to authenticated;
grant execute on function confirm_payment(uuid) to authenticated;
grant execute on function reverse_payment(uuid, text) to authenticated;
revoke execute on function allocate_payment(uuid) from anon, authenticated;
