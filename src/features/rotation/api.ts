import type { MemberStatus } from '@/lib/domain';
import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export type SlotStatus = 'upcoming' | 'due' | 'paid';

export interface RotationSlotRow {
  slotId: string;
  position: number;
  memberId: string;
  memberName: string;
  memberStatus: MemberStatus;
  cycleId: string | null;
  cycleLabel: string | null;
  dueDate: string | null;
  /** What the whole group owes for that period — the pot. */
  expectedPot: Minor;
  collectedSoFar: Minor;
  paidOutAmount: Minor | null;
  paidOutAt: string | null;
  status: SlotStatus;
}

export async function fetchRotation(planId: string): Promise<RotationSlotRow[]> {
  const { data, error } = await supabase
    .from('rotation_status')
    .select(
      'slot_id, position, member_id, member_name, member_status, cycle_id, cycle_label, due_date, expected_pot, collected_so_far, paid_out_amount, paid_out_at, slot_status'
    )
    .eq('plan_id', planId)
    .order('position');

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    slotId: row.slot_id,
    position: Number(row.position),
    memberId: row.member_id,
    memberName: row.member_name,
    memberStatus: row.member_status,
    cycleId: row.cycle_id,
    cycleLabel: row.cycle_label,
    dueDate: row.due_date,
    expectedPot: Number(row.expected_pot ?? 0),
    collectedSoFar: Number(row.collected_so_far ?? 0),
    paidOutAmount: row.paid_out_amount === null ? null : Number(row.paid_out_amount),
    paidOutAt: row.paid_out_at,
    status: row.slot_status,
  }));
}

export async function assignRotation(input: { planId: string; memberIds: string[] }) {
  const { data, error } = await supabase.rpc('assign_rotation', {
    p_plan_id: input.planId,
    p_member_ids: input.memberIds,
  });
  if (error) throw error;
  return data;
}

export async function appendToRotation(input: { planId: string; memberId: string }) {
  const { data, error } = await supabase.rpc('append_to_rotation', {
    p_plan_id: input.planId,
    p_member_id: input.memberId,
  });
  if (error) throw error;
  return data;
}

export async function replaceRotationMember(input: { slotId: string; memberId: string }) {
  const { data, error } = await supabase.rpc('replace_rotation_member', {
    p_slot_id: input.slotId,
    p_member_id: input.memberId,
  });
  if (error) throw error;
  return data;
}

export interface RecordPayoutInput {
  slotId: string;
  amount: Minor;
  /** Treat the recipient's unpaid share as settled from the pot. */
  settleArrears?: boolean;
  note?: string | null;
}

export async function recordPayout(input: RecordPayoutInput) {
  const { data, error } = await supabase.rpc('record_payout', {
    p_slot_id: input.slotId,
    p_amount: input.amount,
    p_settle_arrears: input.settleArrears ?? false,
    p_note: input.note ?? undefined,
  });
  if (error) throw error;
  return data;
}

export async function reversePayout(input: { slotId: string; reason: string }) {
  const { data, error } = await supabase.rpc('reverse_payout', {
    p_slot_id: input.slotId,
    p_reason: input.reason,
  });
  if (error) throw error;
  return data;
}

/** What the recipient still owes on this susu — offered for netting at payout. */
export async function fetchSlotArrears(planId: string, memberId: string): Promise<Minor> {
  const { data, error } = await supabase
    .from('obligation_balances')
    .select('balance, cycles!inner(plan_id)')
    .eq('member_id', memberId)
    .gt('balance', 0);

  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => row.cycles?.plan_id === planId)
    .reduce((sum: number, row: any) => sum + Number(row.balance ?? 0), 0);
}
