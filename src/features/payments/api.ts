import type { PaymentMethod } from '@/lib/domain';
import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export interface RecordPaymentInput {
  groupId: string;
  memberId: string;
  amount: Minor;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  /** ISO date-time. Defaults to now on the server. */
  paidAt?: string;
  /**
   * Earmark the payment to one contribution. Surplus then stays with that
   * contribution as extra giving instead of sweeping into other dues.
   * Leave unset for a general payment.
   */
  designatedPlanId?: string | null;
}

export async function recordPayment(input: RecordPaymentInput) {
  const { data, error } = await supabase.rpc('record_payment', {
    p_group_id: input.groupId,
    p_member_id: input.memberId,
    p_amount: input.amount,
    p_method: input.method,
    // Optional arguments are omitted, not nulled — they carry Postgres defaults.
    p_paid_at: input.paidAt ?? undefined,
    p_reference: input.reference ?? undefined,
    p_note: input.note ?? undefined,
    p_designated_plan_id: input.designatedPlanId ?? undefined,
  });

  if (error) throw error;
  return data;
}

export async function confirmPayment(paymentId: string) {
  const { data, error } = await supabase.rpc('confirm_payment', { p_payment_id: paymentId });
  if (error) throw error;
  return data;
}

export async function reversePayment(input: { paymentId: string; reason: string }) {
  const { data, error } = await supabase.rpc('reverse_payment', {
    p_payment_id: input.paymentId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data;
}

export interface OutstandingObligation {
  obligationId: string;
  cycleLabel: string;
  planId: string;
  planName: string;
  dueDate: string;
  amountDue: Minor;
  amountPaid: Minor;
  balance: Minor;
}

export interface MemberPayment {
  id: string;
  amount: Minor;
  method: string;
  status: string;
  paidAt: string;
  reference: string | null;
  note: string | null;
  /** The contribution it was earmarked for, if any. */
  planName: string | null;
  /** True for a reversing entry, which carries a negative amount. */
  isReversal: boolean;
}

/** Everything this member has paid, newest first. */
export async function fetchMemberPayments(memberId: string): Promise<MemberPayment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select(
      'id, amount, method, status, paid_at, reference, note, reverses_payment_id, plans(name)'
    )
    .eq('member_id', memberId)
    .order('paid_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    paidAt: row.paid_at,
    reference: row.reference,
    note: row.note,
    planName: row.plans?.name ?? null,
    isReversal: row.reverses_payment_id !== null,
  }));
}

/** What a member still owes, oldest first — the order a payment will settle. */
export async function fetchOutstanding(
  groupId: string,
  memberId: string
): Promise<OutstandingObligation[]> {
  const { data, error } = await supabase
    .from('obligation_balances')
    .select(
      'obligation_id, amount_due, amount_paid, balance, cycles!inner(label, due_date, plan_id, plans!inner(name, group_id))'
    )
    .eq('member_id', memberId)
    .gt('balance', 0);

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => ({
      obligationId: row.obligation_id,
      cycleLabel: row.cycles?.label ?? '',
      planId: row.cycles?.plan_id as string,
      planName: row.cycles?.plans?.name ?? '',
      dueDate: row.cycles?.due_date ?? '',
      amountDue: Number(row.amount_due ?? 0),
      amountPaid: Number(row.amount_paid ?? 0),
      balance: Number(row.balance ?? 0),
      groupId: row.cycles?.plans?.group_id as string,
    }))
    .filter((row) => row.groupId === groupId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
