-- Fix: record_expense could never insert a row.
--
--   column "status" is of type expense_status but expression is of type text
--
-- A bare CASE returning string literals resolves to text, and Postgres will not
-- coerce that into an enum inside an INSERT. Assigning to a typed variable first
-- does coerce — which is why record_payment, written the same way but via a
-- variable, worked.

create or replace function record_expense(
  p_group_id uuid,
  p_title text,
  p_amount bigint,
  p_category text default 'general',
  p_spent_at timestamptz default now(),
  p_note text default null
)
returns expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_is_admin boolean;
  v_status expense_status;
  v_expense expenses;
begin
  v_actor_id := current_member_id(p_group_id);
  if v_actor_id is null then
    raise exception 'Not a member of this group';
  end if;

  if not has_group_role(p_group_id, 'treasurer') then
    raise exception 'Only a treasurer or above can record an expense';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero';
  end if;

  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Say what the money was spent on';
  end if;

  if p_spent_at > now() + interval '1 day' then
    raise exception 'An expense cannot be dated in the future';
  end if;

  v_is_admin := has_group_role(p_group_id, 'admin');
  v_status := case when v_is_admin then 'approved' else 'pending' end;

  insert into expenses (
    group_id, title, category, amount, status,
    spent_at, note, recorded_by, approved_by
  )
  values (
    p_group_id,
    trim(p_title),
    nullif(trim(coalesce(p_category, '')), ''),
    p_amount,
    v_status,
    p_spent_at,
    nullif(trim(coalesce(p_note, '')), ''),
    v_actor_id,
    case when v_is_admin then v_actor_id else null end
  )
  returning * into v_expense;

  return v_expense;
end;
$$;

grant execute on function record_expense(uuid, text, bigint, text, timestamptz, text) to authenticated;
