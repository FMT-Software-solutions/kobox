import type { ExpenseStatus } from '@/lib/domain';
import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export interface ExpenseRow {
  id: string;
  title: string;
  category: string | null;
  amount: Minor;
  status: ExpenseStatus;
  spentAt: string;
  note: string | null;
  recordedByName: string;
  voidReason: string | null;
}

export async function fetchExpenses(groupId: string): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select(
      'id, title, category, amount, status, spent_at, note, void_reason, group_members!expenses_recorded_by_fkey(full_name)'
    )
    .eq('group_id', groupId)
    .order('spent_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    amount: Number(row.amount),
    status: row.status,
    spentAt: row.spent_at,
    note: row.note,
    recordedByName: row.group_members?.full_name ?? 'Unknown',
    voidReason: row.void_reason,
  }));
}

export interface RecordExpenseInput {
  groupId: string;
  title: string;
  amount: Minor;
  category?: string;
  note?: string | null;
  spentAt?: string;
}

export async function recordExpense(input: RecordExpenseInput) {
  const { data, error } = await supabase.rpc('record_expense', {
    p_group_id: input.groupId,
    p_title: input.title,
    p_amount: input.amount,
    p_category: input.category ?? undefined,
    p_note: input.note ?? undefined,
    p_spent_at: input.spentAt ?? undefined,
  });

  if (error) throw error;
  return data;
}

export async function approveExpense(expenseId: string) {
  const { data, error } = await supabase.rpc('approve_expense', { p_expense_id: expenseId });
  if (error) throw error;
  return data;
}

export async function rejectExpense(input: { expenseId: string; reason: string }) {
  const { data, error } = await supabase.rpc('reject_expense', {
    p_expense_id: input.expenseId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data;
}

export async function voidExpense(input: { expenseId: string; reason: string }) {
  const { data, error } = await supabase.rpc('void_expense', {
    p_expense_id: input.expenseId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data;
}
