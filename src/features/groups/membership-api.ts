import { supabase } from '@/lib/supabase';

export interface InviteSettings {
  joinCode: string;
  /** Null only for groups created before codes could expire. */
  expiresAt: string | null;
  isExpired: boolean;
  requiresApproval: boolean;
}

export async function fetchInviteSettings(groupId: string): Promise<InviteSettings> {
  const { data, error } = await supabase
    .from('groups')
    .select('join_code, join_code_expires_at, join_requires_approval')
    .eq('id', groupId)
    .single();

  if (error) throw error;

  const expiresAt = data.join_code_expires_at;

  return {
    joinCode: data.join_code,
    expiresAt,
    // Compared on the device, so a phone with a wrong clock can show the wrong
    // badge — but the database is what actually refuses an expired code, so the
    // worst case is a misleading label, never a wrongful admission.
    isExpired: expiresAt !== null && new Date(expiresAt).getTime() < Date.now(),
    requiresApproval: Boolean(data.join_requires_approval),
  };
}

export async function regenerateJoinCode(input: { groupId: string; days?: number }) {
  const { error } = await supabase.rpc('regenerate_join_code', {
    p_group_id: input.groupId,
    ...(input.days === undefined ? {} : { p_days: input.days }),
  });

  if (error) throw error;
}

export async function setJoinPolicy(input: { groupId: string; requiresApproval: boolean }) {
  const { error } = await supabase.rpc('set_join_policy', {
    p_group_id: input.groupId,
    p_requires_approval: input.requiresApproval,
  });

  if (error) throw error;
}

export interface JoinRequest {
  memberId: string;
  fullName: string;
  phone: string | null;
  requestedAt: string;
  /** The existing record this request will be folded into on approval, if any. */
  mergesInto: string | null;
}

export async function fetchJoinRequests(groupId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from('pending_join_requests')
    .select('member_id, full_name, phone, requested_at, merges_into')
    .eq('group_id', groupId)
    .order('requested_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    memberId: row.member_id as string,
    fullName: row.full_name as string,
    phone: row.phone,
    requestedAt: row.requested_at as string,
    mergesInto: row.merges_into ?? null,
  }));
}

export async function approveJoinRequest(input: { memberId: string; includePast?: boolean }) {
  const { error } = await supabase.rpc('approve_join_request', {
    p_member_id: input.memberId,
    ...(input.includePast === undefined ? {} : { p_include_past_periods: input.includePast }),
  });

  if (error) throw error;
}

export async function declineJoinRequest(memberId: string) {
  const { error } = await supabase.rpc('decline_join_request', { p_member_id: memberId });
  if (error) throw error;
}

export interface MyJoinRequest {
  memberId: string;
  groupId: string;
  groupName: string;
  requestedAt: string;
}

/**
 * The caller's own outstanding requests.
 *
 * A pending member fails `is_group_member()`, so they can read neither the
 * group nor their own row through the normal policies — correct, since the
 * group's money is none of their business yet. This RPC returns the one thing
 * they are entitled to: that they asked, and who they asked.
 */
export async function fetchMyJoinRequests(): Promise<MyJoinRequest[]> {
  const { data, error } = await supabase.rpc('my_join_requests');
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    memberId: row.member_id as string,
    groupId: row.group_id as string,
    groupName: row.group_name as string,
    requestedAt: row.requested_at as string,
  }));
}
