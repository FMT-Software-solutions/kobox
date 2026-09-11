-- Surface "has money attached" so the app can hide Delete rather than offering
-- an action that is guaranteed to fail.
--
-- The database still refuses the delete — this is only so the button does not
-- appear in the first place. Hiding an action is a courtesy; the rule lives in
-- delete_plan().

create or replace view plan_summaries
with (security_invoker = true)
as
select
  p.id                                                              as plan_id,
  p.group_id,
  coalesce(cy.cycle_count, 0)::int                                  as cycle_count,
  coalesce(ob.total_due, 0)::bigint                                 as total_expected,
  (coalesce(ob.total_paid, 0) + coalesce(dn.designated, 0))::bigint as total_collected,
  coalesce(dn.designated, 0)::bigint                                as extra_giving,
  (
    coalesce(ob.total_paid, 0) > 0
    or coalesce(dn.designated, 0) > 0
    or exists (
      select 1 from payments pay
      where pay.designated_plan_id = p.id
        and pay.status in ('pending', 'confirmed', 'reversed')
    )
  )                                                                 as has_money
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
