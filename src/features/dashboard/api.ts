import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export interface GroupSummary {
  cashOnHand: Minor;
  totalCollected: Minor;
  totalExpenses: Minor;
  /** Recorded but not yet approved, so not counted against the balance. */
  pendingExpenses: Minor;
  activeMembers: number;
}

export async function fetchGroupSummary(groupId: string): Promise<GroupSummary> {
  const { data, error } = await supabase
    .from('group_summaries')
    .select('cash_on_hand, total_collected, total_expenses, pending_expenses, active_members')
    .eq('group_id', groupId)
    .single();

  if (error) throw error;

  return {
    cashOnHand: Number(data.cash_on_hand ?? 0),
    totalCollected: Number(data.total_collected ?? 0),
    totalExpenses: Number(data.total_expenses ?? 0),
    pendingExpenses: Number(data.pending_expenses ?? 0),
    activeMembers: Number(data.active_members ?? 0),
  };
}

export interface RecentPayment {
  id: string;
  amount: Minor;
  method: string;
  status: string;
  paidAt: string;
  reference: string | null;
  memberName: string;
  /** The contribution this was earmarked for, if any. */
  planName: string | null;
}

/**
 * Recent payments for the dashboard.
 *
 * `memberId` narrows it to one person's own payments. That is what an ordinary
 * member sees: the whole group's ledger is a treasurer's view, but "did my
 * payment go through?" is the question a member opens the app to answer, and
 * leaving it out left the screen mostly empty for them.
 *
 * Filtered here rather than left to RLS on purpose — a member may SELECT every
 * payment in their own group, so without this filter they would see everyone's.
 * Same trap as `fetchMyMemberships`.
 */
export async function fetchRecentPayments(
  groupId: string,
  limit = 10,
  memberId?: string
): Promise<RecentPayment[]> {
  let query = supabase
    .from('payments')
    .select(
      'id, amount, method, status, paid_at, reference, group_members!payments_member_id_fkey(full_name), plans(name)'
    )
    .eq('group_id', groupId);

  if (memberId) query = query.eq('member_id', memberId);

  const { data, error } = await query.order('paid_at', { ascending: false }).limit(limit);

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    paidAt: row.paid_at,
    reference: row.reference,
    memberName: row.group_members?.full_name ?? 'Unknown member',
    planName: row.plans?.name ?? null,
  }));
}

export interface MemberStanding {
  totalDue: Minor;
  totalPaid: Minor;
  balance: Minor;
  /** Money paid in advance that no obligation has claimed yet. */
  credit: Minor;
}

/**
 * What the signed-in member owes, and what they hold in advance.
 * Derived from member_standings so it can never disagree with the ledger.
 */
export async function fetchMyStanding(memberId: string): Promise<MemberStanding> {
  const { data, error } = await supabase
    .from('member_standings')
    .select('total_due, total_paid, balance, credit')
    .eq('member_id', memberId)
    .single();

  if (error) throw error;

  return {
    totalDue: Number(data.total_due ?? 0),
    totalPaid: Number(data.total_paid ?? 0),
    balance: Number(data.balance ?? 0),
    credit: Number(data.credit ?? 0),
  };
}
