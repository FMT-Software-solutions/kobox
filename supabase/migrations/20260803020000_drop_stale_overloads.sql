-- Remove superseded function signatures.
--
-- `create or replace function` only replaces a function with the SAME argument
-- list. Adding a parameter creates a second overload instead, and PostgREST then
-- cannot decide which to call:
--
--   Could not choose the best candidate function between:
--     public.create_plan(..., p_start_date => date),
--     public.create_plan(..., p_start_date => date, p_end_date => date)
--
-- Every call that omitted the new argument was failing. Dropping the old
-- signatures leaves exactly one candidate for each.

drop function if exists public.create_plan(
  uuid, text, plan_kind, plan_frequency, bigint, int, date
);

drop function if exists public.update_plan(
  uuid, text, bigint, int, date, plan_status
);

drop function if exists public.add_member(
  uuid, text, text, member_role
);

drop function if exists public.record_payment(
  uuid, uuid, bigint, payment_method, timestamptz, text, text
);

-- Guard against this class of mistake returning unnoticed.
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
        'apply_credit', 'allocate_payment', 'confirm_payment', 'reverse_payment'
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
