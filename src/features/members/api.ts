import type { MemberRole, MemberStatus } from '@/lib/domain';
import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export interface MemberRow {
  id: string;
  fullName: string;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  /** True when this member has their own Kobox account. */
  hasAccount: boolean;
  totalDue: Minor;
  totalPaid: Minor;
  balance: Minor;
}

export async function fetchMembers(groupId: string): Promise<MemberRow[]> {
  const [membersResult, standingsResult] = await Promise.all([
    supabase
      .from('group_members')
      .select('id, full_name, phone, role, status, user_id')
      .eq('group_id', groupId)
      .neq('status', 'left')
      .order('full_name'),
    supabase
      .from('member_standings')
      .select('member_id, total_due, total_paid, balance')
      .eq('group_id', groupId),
  ]);

  if (membersResult.error) throw membersResult.error;
  if (standingsResult.error) throw standingsResult.error;

  const standings = new Map(
    (standingsResult.data ?? []).map((row: any) => [
      row.member_id as string,
      {
        totalDue: Number(row.total_due ?? 0),
        totalPaid: Number(row.total_paid ?? 0),
        balance: Number(row.balance ?? 0),
      },
    ])
  );

  return (membersResult.data ?? []).map((row: any) => {
    const standing = standings.get(row.id) ?? { totalDue: 0, totalPaid: 0, balance: 0 };
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      role: row.role,
      status: row.status,
      hasAccount: row.user_id !== null,
      ...standing,
    };
  });
}

export interface AddMemberInput {
  groupId: string;
  fullName: string;
  /**
   * Required. `add_member` refuses without it: a record with no number can
   * never be linked to the person it describes, so it guarantees a duplicate
   * the moment they sign up.
   */
  phone: string;
  role?: MemberRole;
  /**
   * Issue obligations for periods that closed before this member joined.
   * Whether a late joiner owes the back months is a group's own decision.
   */
  includePastPeriods?: boolean;
}

export async function addMember(input: AddMemberInput) {
  const { data, error } = await supabase.rpc('add_member', {
    p_group_id: input.groupId,
    p_full_name: input.fullName,
    p_phone: input.phone,
    p_role: input.role ?? 'member',
    p_include_past_periods: input.includePastPeriods ?? false,
  });

  if (error) throw error;
  return data;
}

export async function setMemberRole(input: { memberId: string; role: MemberRole }) {
  const { error } = await supabase.rpc('set_member_role', {
    p_member_id: input.memberId,
    p_role: input.role,
  });

  if (error) throw error;
}
