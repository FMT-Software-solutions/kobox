-- Money going out.
--
-- Expenses mirror payments deliberately: a treasurer records, an admin approves,
-- and once approved the record is protected. Only approved expenses move the
-- group balance, so nothing leaves the books on one person's say-so.

-- Undoing an approved expense keeps who did it and why, rather than quietly
-- flipping a status.
alter table expenses
  add column voided_at timestamptz,
  add column voided_by uuid references group_members (id),
  add column void_reason text;

/**
 * Records money the group has spent.
 *
 * An admin or owner recording it approves it in the same step — they already
 * hold the authority. A treasurer's entry waits for approval, so spending is
 * always seen by a second pair of eyes.
 */
create function record_expense(
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

  insert into expenses (
    group_id, title, category, amount, status,
    spent_at, note, recorded_by, approved_by
  )
  values (
    p_group_id,
    trim(p_title),
    nullif(trim(coalesce(p_category, '')), ''),
    p_amount,
    case when v_is_admin then 'approved' else 'pending' end,
    p_spent_at,
    nullif(trim(coalesce(p_note, '')), ''),
    v_actor_id,
    case when v_is_admin then v_actor_id else null end
  )
  returning * into v_expense;

  return v_expense;
end;
$$;

create function approve_expense(p_expense_id uuid)
returns expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense expenses;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if v_expense.id is null then
    raise exception 'Expense not found';
  end if;

  if not has_group_role(v_expense.group_id, 'admin') then
    raise exception 'Only an admin or owner can approve an expense';
  end if;

  if v_expense.status <> 'pending' then
    raise exception 'Only a pending expense can be approved';
  end if;

  update expenses
  set status = 'approved',
      approved_by = current_member_id(v_expense.group_id)
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

create function reject_expense(p_expense_id uuid, p_reason text)
returns expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense expenses;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if v_expense.id is null then
    raise exception 'Expense not found';
  end if;

  if not has_group_role(v_expense.group_id, 'admin') then
    raise exception 'Only an admin or owner can reject an expense';
  end if;

  if v_expense.status <> 'pending' then
    raise exception 'Only a pending expense can be rejected';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason';
  end if;

  update expenses
  set status = 'rejected',
      void_reason = trim(p_reason),
      voided_by = current_member_id(v_expense.group_id),
      voided_at = now()
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

/**
 * Undoes an approved expense. The row stays, marked rejected and stamped with
 * who undid it and why, so the group balance corrects itself without the
 * spending disappearing from the record.
 */
create function void_expense(p_expense_id uuid, p_reason text)
returns expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense expenses;
begin
  select * into v_expense from expenses where id = p_expense_id;
  if v_expense.id is null then
    raise exception 'Expense not found';
  end if;

  if not has_group_role(v_expense.group_id, 'admin') then
    raise exception 'Only an admin or owner can void an expense';
  end if;

  if v_expense.status <> 'approved' then
    raise exception 'Only an approved expense can be voided';
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Give a reason for voiding this expense';
  end if;

  update expenses
  set status = 'rejected',
      void_reason = trim(p_reason),
      voided_by = current_member_id(v_expense.group_id),
      voided_at = now()
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

/*
 * An approved expense is a financial record. Its figures are frozen; the only
 * permitted move is to void it, which is recorded rather than hidden.
 */
create function protect_approved_expenses()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
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

create trigger expenses_protect_approved
  before update or delete on expenses
  for each row execute function protect_approved_expenses();

grant execute on function record_expense(uuid, text, bigint, text, timestamptz, text) to authenticated;
grant execute on function approve_expense(uuid) to authenticated;
grant execute on function reject_expense(uuid, text) to authenticated;
grant execute on function void_expense(uuid, text) to authenticated;

/*
 * Pending spending is worth surfacing separately: money the group expects to
 * lose but has not yet agreed to.
 *
 * NOTE: `create or replace view` cannot insert a column in the middle or rename
 * one — new columns must be APPENDED. Hence pending_expenses sits last rather
 * than beside total_expenses where it reads more naturally.
 */
create or replace view group_summaries
with (security_invoker = true)
as
select
  g.id as group_id,
  coalesce((
    select sum(p.amount) from payments p
    where p.group_id = g.id and p.status in ('confirmed', 'reversed')
  ), 0)::bigint as total_collected,
  coalesce((
    select sum(e.amount) from expenses e
    where e.group_id = g.id and e.status = 'approved'
  ), 0)::bigint as total_expenses,
  coalesce((
    select sum(p.amount) from payments p
    where p.group_id = g.id and p.status in ('confirmed', 'reversed')
  ), 0)::bigint
  - coalesce((
    select sum(e.amount) from expenses e
    where e.group_id = g.id and e.status = 'approved'
  ), 0)::bigint as cash_on_hand,
  (
    select count(*) from group_members m
    where m.group_id = g.id and m.status = 'active'
  )::int as active_members,
  coalesce((
    select sum(e.amount) from expenses e
    where e.group_id = g.id and e.status = 'pending'
  ), 0)::bigint as pending_expenses
from groups g;
