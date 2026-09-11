-- One contribution, every member, what each has paid.
--
-- The report a group actually circulates. "Hall Levy — here is who has paid so
-- far, and the total" is the message that goes into the WhatsApp group after a
-- collection, and it is the one thing none of the existing reports can produce:
-- the cash book aggregates across contributions, and the arrears list spans all
-- of them.
--
-- Every member in the contribution's audience appears, including those who have
-- paid nothing — a list that silently omits them is exactly the list nobody can
-- use to chase.

create function plan_member_report(p_plan_id uuid)
returns table (
  member_id  uuid,
  full_name  text,
  total_due  bigint,
  total_paid bigint,
  balance    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.full_name,
    coalesce(sum(b.amount_due), 0)::bigint,
    coalesce(sum(b.amount_paid), 0)::bigint,
    coalesce(sum(b.amount_due - b.amount_paid), 0)::bigint
  from plans pl
  join group_members m on m.group_id = pl.group_id and m.status = 'active'
  -- Only this plan's obligations. A LEFT JOIN so somebody who has been issued
  -- nothing yet still gets a row at zero rather than vanishing.
  left join cycles c on c.plan_id = pl.id
  left join obligation_balances b on b.cycle_id = c.id and b.member_id = m.id
  where pl.id = p_plan_id
    and has_group_role(pl.group_id, 'auditor')
    -- Whoever the contribution is actually for: a susu bills only its rotation,
    -- a tagged contribution only that tag. One rule, already written down.
    and plan_obligation_amount(pl.id, m.id) is not null
  group by m.id, m.full_name
  -- Most paid first: this is a list a group reads out to acknowledge people.
  order by 4 desc, m.full_name;
$$;

grant execute on function plan_member_report(uuid) to authenticated;
