-- Reports.
--
-- Every existing view answers "as of now": `group_summaries` sums every payment
-- ever recorded, `member_standings` and `plan_summaries` likewise. None of them
-- can answer "between two dates", which is what a report is.
--
-- Two functions, because there are two different questions and mixing them
-- produces figures that do not reconcile:
--
--   * "What moved in September?" is about `paid_at` and `spent_at`. Cash.
--   * "Who is behind?" is about CYCLES and obligations, and has no date range
--     at all — a member is in arrears on a period, not on a Tuesday.
--
-- Both are readable by an **auditor and above**. `has_group_role(gid,
-- 'auditor')` means rank >= auditor, so treasurer, admin and owner are included
-- — the role existed and unlocked nothing until now, and read-only sight of the
-- books is exactly what it is for.

-- ---------------------------------------------------------------------------
-- Cash: what moved, and what is left
-- ---------------------------------------------------------------------------

/**
 * Money in, money out and the balance either side of a date window.
 *
 * `opening_balance` is every confirmed movement STRICTLY BEFORE p_from, so a
 * run of consecutive reports chains: each closing balance is the next opening
 * balance exactly. That property is the whole reason a treasurer can read these
 * aloud at successive meetings without the numbers drifting.
 *
 * Reversals are included (`status in ('confirmed','reversed')`) because a
 * reversal is itself a negative payment row — the correction has to land in the
 * period it was made, not silently remove money from the period being reported.
 */
create function group_cash_report(p_group_id uuid, p_from date, p_to date)
returns table (
  opening_balance bigint,
  money_in        bigint,
  money_out       bigint,
  closing_balance bigint,
  payment_count   int,
  expense_count   int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Raised, not returned empty: a refusal must never be mistaken for a group
  -- that simply has no money.
  if not has_group_role(p_group_id, 'auditor') then
    raise exception 'Not allowed to read this group''s reports';
  end if;

  return query
  with paid as (
    select coalesce(sum(amount), 0)::bigint as total, count(*)::int as n
    from payments
    where group_id = p_group_id
      and status in ('confirmed', 'reversed')
      and paid_at::date between p_from and p_to
  ),
  spent as (
    select coalesce(sum(amount), 0)::bigint as total, count(*)::int as n
    from expenses
    where group_id = p_group_id
      and status = 'approved'
      and spent_at::date between p_from and p_to
  ),
  before as (
    select
      coalesce((
        select sum(amount) from payments
        where group_id = p_group_id
          and status in ('confirmed', 'reversed')
          and paid_at::date < p_from
      ), 0)::bigint
      - coalesce((
        select sum(amount) from expenses
        where group_id = p_group_id
          and status = 'approved'
          and spent_at::date < p_from
      ), 0)::bigint as balance
  )
  select
    before.balance,
    paid.total,
    spent.total,
    before.balance + paid.total - spent.total,
    paid.n,
    spent.n
  from paid, spent, before;
end;
$$;

/** Money in for the window, split by contribution. Names the plan so a report
    reads "Monthly Dues ₵4,000" rather than a uuid. */
create function group_cash_by_plan(p_group_id uuid, p_from date, p_to date)
returns table (plan_id uuid, plan_name text, collected bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    coalesce(p.name, 'Unallocated'),
    coalesce(sum(a.amount), 0)::bigint
  from payments pay
  join allocations a on a.payment_id = pay.id
  left join obligations o on o.id = a.obligation_id
  left join cycles c on c.id = o.cycle_id
  left join plans p on p.id = coalesce(c.plan_id, a.plan_id)
  where pay.group_id = p_group_id
    and pay.status in ('confirmed', 'reversed')
    and pay.paid_at::date between p_from and p_to
    and has_group_role(p_group_id, 'auditor')
  group by p.id, p.name
  having coalesce(sum(a.amount), 0) <> 0
  order by 3 desc;
$$;

/** Money in for the window, split by how it was paid. */
create function group_cash_by_method(p_group_id uuid, p_from date, p_to date)
returns table (method payment_method, collected bigint, payment_count int)
language sql
stable
security definer
set search_path = public
as $$
  select p.method, sum(p.amount)::bigint, count(*)::int
  from payments p
  where p.group_id = p_group_id
    and p.status in ('confirmed', 'reversed')
    and p.paid_at::date between p_from and p_to
    and has_group_role(p_group_id, 'auditor')
  group by p.method
  order by 2 desc;
$$;

-- ---------------------------------------------------------------------------
-- Arrears: who is behind
--
-- Deliberately NOT date-ranged. Arrears are a position, not a flow: a member
-- owes for a PERIOD, and asking "who was behind between June and August" is a
-- question with no honest answer once they have since paid.
--
-- Built on `obligation_balances`, so it inherits the rule that money paid ahead
-- is never netted against what somebody else owes.
-- ---------------------------------------------------------------------------

create function member_arrears_report(p_group_id uuid)
returns table (
  member_id     uuid,
  full_name     text,
  phone         text,
  role          member_role,
  total_due     bigint,
  total_paid    bigint,
  balance       bigint,
  credit        bigint,
  last_paid_at  timestamptz,
  periods_owed  int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.full_name,
    m.phone,
    m.role,
    coalesce(s.total_due, 0)::bigint,
    coalesce(s.total_paid, 0)::bigint,
    coalesce(s.balance, 0)::bigint,
    coalesce(s.credit, 0)::bigint,
    (
      select max(p.paid_at) from payments p
      where p.member_id = m.id and p.status = 'confirmed'
    ),
    (
      select count(*)::int
      from obligation_balances b
      join cycles c on c.id = b.cycle_id
      where b.member_id = m.id
        and b.amount_due > b.amount_paid
    )
  from group_members m
  left join member_standings s on s.member_id = m.id
  where m.group_id = p_group_id
    and m.status = 'active'
    and has_group_role(p_group_id, 'auditor')
  -- Worst first: a chase list is only useful in the order you would work it.
  order by coalesce(s.balance, 0) desc, m.full_name;
$$;

grant execute on function group_cash_report(uuid, date, date) to authenticated;
grant execute on function group_cash_by_plan(uuid, date, date) to authenticated;
grant execute on function group_cash_by_method(uuid, date, date) to authenticated;
grant execute on function member_arrears_report(uuid) to authenticated;

