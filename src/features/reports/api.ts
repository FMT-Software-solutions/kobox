import type { MemberRole } from '@/lib/domain';
import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export interface CashReport {
  openingBalance: Minor;
  moneyIn: Minor;
  moneyOut: Minor;
  closingBalance: Minor;
  paymentCount: number;
  expenseCount: number;
}

export interface CashByPlan {
  planId: string | null;
  planName: string;
  collected: Minor;
}

export interface CashByMethod {
  method: string;
  collected: Minor;
  paymentCount: number;
}

export interface ArrearsRow {
  memberId: string;
  fullName: string;
  phone: string | null;
  role: MemberRole;
  totalDue: Minor;
  totalPaid: Minor;
  balance: Minor;
  credit: Minor;
  lastPaidAt: string | null;
  periodsOwed: number;
}

export interface DateRange {
  from: string;
  to: string;
}

export async function fetchCashReport(groupId: string, range: DateRange): Promise<CashReport> {
  const { data, error } = await supabase.rpc('group_cash_report', {
    p_group_id: groupId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) throw error;

  // `returns table` always yields an array, even for a single row.
  const row = (data ?? [])[0];

  return {
    openingBalance: Number(row?.opening_balance ?? 0),
    moneyIn: Number(row?.money_in ?? 0),
    moneyOut: Number(row?.money_out ?? 0),
    closingBalance: Number(row?.closing_balance ?? 0),
    paymentCount: Number(row?.payment_count ?? 0),
    expenseCount: Number(row?.expense_count ?? 0),
  };
}

export async function fetchCashByPlan(groupId: string, range: DateRange): Promise<CashByPlan[]> {
  const { data, error } = await supabase.rpc('group_cash_by_plan', {
    p_group_id: groupId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? 'Unallocated',
    collected: Number(row.collected ?? 0),
  }));
}

export async function fetchCashByMethod(
  groupId: string,
  range: DateRange
): Promise<CashByMethod[]> {
  const { data, error } = await supabase.rpc('group_cash_by_method', {
    p_group_id: groupId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    method: row.method as string,
    collected: Number(row.collected ?? 0),
    paymentCount: Number(row.payment_count ?? 0),
  }));
}

/**
 * Arrears, optionally narrowed to the periods that START inside the range.
 *
 * Filters the CYCLE, never `paid_at`: 'who owes for June to August' is a
 * question about which periods are unpaid, not about somebody's balance on a
 * given day. Omitting the range asks about every period.
 */
export async function fetchArrears(groupId: string, range?: DateRange): Promise<ArrearsRow[]> {
  const { data, error } = await supabase.rpc('member_arrears_report', {
    p_group_id: groupId,
    ...(range ? { p_from: range.from, p_to: range.to } : {}),
  });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    memberId: row.member_id as string,
    fullName: row.full_name as string,
    phone: row.phone ?? null,
    role: row.role as MemberRole,
    totalDue: Number(row.total_due ?? 0),
    totalPaid: Number(row.total_paid ?? 0),
    balance: Number(row.balance ?? 0),
    credit: Number(row.credit ?? 0),
    lastPaidAt: row.last_paid_at ?? null,
    periodsOwed: Number(row.periods_owed ?? 0),
  }));
}

export interface CollectionRow {
  paymentId: string;
  paidAt: string;
  memberId: string;
  memberName: string;
  planId: string | null;
  planName: string;
  method: string;
  status: string;
  amount: Minor;
}

/**
 * Every payment in the window, with who paid and what for.
 *
 * The cash book gives totals; this gives the rows behind them. A treasurer
 * reconciling a month's takings against the names in their notebook needs the
 * rows, and no amount of aggregate can be turned back into them.
 */
export async function fetchCollections(
  groupId: string,
  range: DateRange
): Promise<CollectionRow[]> {
  const { data, error } = await supabase.rpc('group_collections', {
    p_group_id: groupId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    paymentId: row.payment_id as string,
    paidAt: row.paid_at as string,
    memberId: row.member_id as string,
    memberName: row.member_name as string,
    planId: row.plan_id ?? null,
    planName: row.plan_name as string,
    method: row.method as string,
    status: row.status as string,
    amount: Number(row.amount ?? 0),
  }));
}

export interface PlanMemberRow {
  memberId: string;
  fullName: string;
  totalDue: Minor;
  totalPaid: Minor;
  balance: Minor;
}

/** One contribution, every member in its audience, what each has paid. */
export async function fetchPlanMemberReport(planId: string): Promise<PlanMemberRow[]> {
  const { data, error } = await supabase.rpc('plan_member_report', { p_plan_id: planId });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    memberId: row.member_id as string,
    fullName: row.full_name as string,
    totalDue: Number(row.total_due ?? 0),
    totalPaid: Number(row.total_paid ?? 0),
    balance: Number(row.balance ?? 0),
  }));
}
