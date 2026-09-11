-- Designated payments, voluntary giving, and joining members with arrears.
--
-- Until now every payment was general: it settled the oldest obligation anywhere
-- in the group and any surplus became credit that swept into whatever came next.
-- That is right for dues and wrong for everything else. A levy someone chose to
-- over-pay, or a voluntary appeal with no fixed amount, needs the money to stay
-- where the giver intended it.

alter table payments
  add column designated_plan_id uuid references plans (id) on delete set null;

comment on column payments.designated_plan_id is
  'When set, this payment only settles obligations of that plan and any surplus is recorded as extra giving to it, never swept into other contributions.';

/**
 * Applies a confirmed payment.
 *
 * Designated: settles only that plan''s obligations, oldest first; surplus is
 * recorded against the plan with no obligation — extra giving that stays put.
 *
 * General: settles the member''s oldest obligation across every plan; surplus
 * becomes unattached credit that later cycles can claim.
 *
 * Either way allocations sum to exactly the payment, so reconciliation never has
 * to explain a difference.
 */
create or replace function allocate_payment(p_payment_id uuid)
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
    return;
  end if;

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
      and (v_payment.designated_plan_id is null or p.id = v_payment.designated_plan_id)
    order by c.due_date, c.period_start
  loop
    exit when v_remaining <= 0;

    v_take := least(v_remaining, r.balance);

    insert into allocations (payment_id, obligation_id, plan_id, amount)
    values (p_payment_id, r.obligation_id, r.plan_id, v_take);

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    -- Designated surplus keeps its plan and is therefore never swept by
    -- apply_credit; general surplus has no plan and is available to future cycles.
    insert into allocations (payment_id, obligation_id, plan_id, amount)
    values (p_payment_id, null, v_payment.designated_plan_id, v_remaining);
  end if;
end;
$$;

-- Only general credit is swept; designated giving stays with its contribution.
create or replace function apply_credit(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r_credit record;
  r_ob record;
  v_left bigint;
  v_take bigint;
begin
  for r_credit in
    select a.id, a.amount, a.payment_id
    from allocations a
    join payments p on p.id = a.payment_id
    where a.obligation_id is null
      and a.plan_id is null            -- general credit only
      and a.amount > 0
      and p.member_id = p_member_id
      and p.status = 'confirmed'
    order by p.paid_at, a.created_at
  loop
    v_left := r_credit.amount;

    for r_ob in
      select b.obligation_id, b.balance, c.plan_id
      from obligation_balances b
      join cycles c on c.id = b.cycle_id
      where b.member_id = p_member_id
        and b.balance > 0
      order by c.due_date, c.period_start
    loop
      exit when v_left <= 0;

      v_take := least(v_left, r_ob.balance);

      insert into allocations (payment_id, obligation_id, plan_id, amount)
      values (r_credit.payment_id, r_ob.obligation_id, r_ob.plan_id, v_take);

      v_left := v_left - v_take;
    end loop;

    if v_left <= 0 then
      delete from allocations where id = r_credit.id;
    elsif v_left < r_credit.amount then
      update allocations set amount = v_left where id = r_credit.id;
    end if;
  end loop;
end;
$$;

create or replace function record_payment(
  p_group_id uuid,
  p_member_id uuid,
  p_amount bigint,
  p_method payment_method,
  p_paid_at timestamptz default now(),
  p_reference text default null,
  p_note text default null,
  p_designated_plan_id uuid default null
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

  if p_designated_plan_id is not null and not exists (
    select 1 from plans where id = p_designated_plan_id and group_id = p_group_id
  ) then
    raise exception 'That contribution does not belong to this group';
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
    paid_at, reference, note, recorded_by, confirmed_by, designated_plan_id
  )
  values (
    p_group_id, p_member_id, p_amount, p_method, v_status,
    p_paid_at, nullif(trim(coalesce(p_reference, '')), ''),
    nullif(trim(coalesce(p_note, '')), ''),
    v_actor_id,
    case when v_is_treasurer then v_actor_id else null end,
    p_designated_plan_id
  )
  returning * into v_payment;

  perform allocate_payment(v_payment.id);

  return v_payment;
end;
$$;

grant execute on function record_payment(uuid, uuid, bigint, payment_method, timestamptz, text, text, uuid) to authenticated;

/**
 * Adds a member, optionally inheriting the arrears that built up before they
 * joined.
 *
 * Whether a late joiner owes the back months is a decision each group makes for
 * itself — a welfare society usually says yes, a savings circle usually says no.
 * The app must not decide silently either way, so it is an explicit choice, and
 * what they *would* owe is visible regardless.
 */
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
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin or owner can add members';
  end if;

  if length(trim(coalesce(p_full_name, ''))) = 0 then
    raise exception 'Enter the member''s name';
  end if;

  if p_role = 'owner' and not has_group_role(p_group_id, 'owner') then
    raise exception 'Only the owner can appoint another owner';
  end if;

  insert into group_members (group_id, user_id, full_name, phone, role, status)
  values (p_group_id, null, trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), p_role, 'active')
  returning * into v_member;

  insert into obligations (cycle_id, member_id, amount_due)
  select c.id, v_member.id, p.default_amount
  from cycles c
  join plans p on p.id = c.plan_id
  where p.group_id = p_group_id
    and p.status = 'active'
    and p.kind <> 'open'
    and p.default_amount is not null
    and (p_include_past_periods or c.status = 'open')
  on conflict (cycle_id, member_id) do nothing;

  return v_member;
end;
$$;

grant execute on function add_member(uuid, text, text, member_role, boolean) to authenticated;

-- Plan totals must count designated giving, not just settled obligations —
-- otherwise a voluntary appeal would always report zero collected.
create or replace view plan_summaries
with (security_invoker = true)
as
select
  p.id                                                              as plan_id,
  p.group_id,
  coalesce(cy.cycle_count, 0)::int                                  as cycle_count,
  coalesce(ob.total_due, 0)::bigint                                 as total_expected,
  (coalesce(ob.total_paid, 0) + coalesce(dn.designated, 0))::bigint as total_collected,
  coalesce(dn.designated, 0)::bigint                                as extra_giving
from plans p
left join (
  select plan_id, count(*)::int as cycle_count
  from cycles
  group by plan_id
) cy on cy.plan_id = p.id
left join (
  select c.plan_id, sum(b.amount_due) as total_due, sum(b.amount_paid) as total_paid
  from cycles c
  join obligation_balances b on b.cycle_id = c.id
  group by c.plan_id
) ob on ob.plan_id = p.id
left join (
  select a.plan_id, sum(a.amount) as designated
  from allocations a
  join payments pay on pay.id = a.payment_id
  where a.obligation_id is null
    and a.plan_id is not null
    and pay.status = 'confirmed'
  group by a.plan_id
) dn on dn.plan_id = p.id;
