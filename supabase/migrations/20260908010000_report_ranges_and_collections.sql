-- Arrears by period, and a collections report.
--
-- The earlier note said arrears are "a position, not a flow" and refused a date
-- range. That is still true of the question it was answering — "who was behind
-- on 3 June" has no honest answer once they have since paid, because the row
-- that would prove it has been settled.
--
-- But "who owes for the June to August periods" is a different question and a
-- perfectly answerable one: an obligation belongs to a CYCLE, and a cycle has a
-- period. So the range here filters `cycles.period_start`, never `paid_at`. It
-- asks which periods are unpaid, not what somebody's balance was on a date.
--
-- Two fields stay deliberately unscoped, because narrowing them would be a lie:
--   * `credit` is money the group is holding right now. It belongs to no period.
--   * `last_paid_at` is the last payment they ever made. Scoping it to the
--     window would show "never paid" for somebody who paid last week.

-- The 1-argument version must GO, not gain an overload: `create or replace`
-- with a different argument list ADDS one, and PostgREST then refuses to choose
-- between them. This project has already shipped that bug once.
drop function if exists member_arrears_report(uuid);

create function member_arrears_report(
  p_group_id uuid,
  p_from date default null,
  p_to date default null
)
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
    coalesce(sum(b.amount_due), 0)::bigint,
    coalesce(sum(b.amount_paid), 0)::bigint,
    coalesce(sum(b.amount_due - b.amount_paid), 0)::bigint,
    coalesce(s.credit, 0)::bigint,
    (
      select max(p.paid_at) from payments p
      where p.member_id = m.id and p.status = 'confirmed'
    ),
    count(*) filter (where b.amount_due > b.amount_paid)::int
  from group_members m
  left join member_standings s on s.member_id = m.id
  left join obligation_balances b on b.member_id = m.id
  left join cycles c on c.id = b.cycle_id
  left join plans pl on pl.id = c.plan_id and pl.group_id = p_group_id
  where m.group_id = p_group_id
    and m.status = 'active'
    and has_group_role(p_group_id, 'auditor')
    -- NULL means "every period", so the unranged call still works.
    and (b.obligation_id is null or pl.id is not null)
    and (p_from is null or c.period_start >= p_from)
    and (p_to   is null or c.period_start <= p_to)
  group by m.id, m.full_name, m.phone, m.role, s.credit
  -- Worst first: a chase list is only useful in the order you would work it.
  order by 7 desc, m.full_name;
$$;

grant execute on function member_arrears_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Collections: what came in, and from whom
--
-- The cash book answers "how much" in totals. This answers "from whom, and for
-- what" — the same window, one row per payment. A treasurer reconciling a
-- month's takings against the names in their notebook needs the rows, not the
-- sum, and building it from the cash book's aggregates is impossible.
-- ---------------------------------------------------------------------------

create function group_collections(p_group_id uuid, p_from date, p_to date)
returns table (
  payment_id  uuid,
  paid_at     timestamptz,
  member_id   uuid,
  member_name text,
  plan_id     uuid,
  plan_name   text,
  method      payment_method,
  status      payment_status,
  amount      bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.paid_at,
    m.id,
    m.full_name,
    pl.id,
    coalesce(pl.name, 'Not earmarked'),
    p.method,
    p.status,
    p.amount::bigint
  from payments p
  join group_members m on m.id = p.member_id
  -- The plan a payment was designated to. A general payment names none, which
  -- is a fact about it rather than missing data, hence 'Not earmarked'.
  left join plans pl on pl.id = p.designated_plan_id
  where p.group_id = p_group_id
    and p.status in ('confirmed', 'reversed')
    and p.paid_at::date between p_from and p_to
    and has_group_role(p_group_id, 'auditor')
  order by p.paid_at desc;
$$;

grant execute on function group_collections(uuid, date, date) to authenticated;
