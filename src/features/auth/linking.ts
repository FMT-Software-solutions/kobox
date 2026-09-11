import { supabase } from '@/lib/supabase';

/**
 * Claims every member record matching the signed-in user's verified phone.
 *
 * Returns how many were claimed, so the caller can refetch memberships when it
 * is worth doing. Safe and cheap to call on every launch: the database refuses
 * without a confirmed phone, only ever takes unclaimed records, and does
 * nothing at all when there is nothing to claim.
 *
 * Called on launch rather than only after a phone sign-in on purpose — a
 * treasurer may add someone to a NEW group months later, and that member should
 * see it without having to do anything.
 */
export async function claimMemberships(): Promise<number> {
  const { data, error } = await supabase.rpc('claim_memberships');
  if (error) throw error;
  return Number(data ?? 0);
}

export interface MemberLinkNotice {
  eventId: string;
  kind: 'linked' | 'ambiguous';
  /** Null for an ambiguous notice — that is the point of it. */
  memberName: string | null;
  phone: string;
  createdAt: string;
}

/** Outstanding link notices for a group, newest first. Admins only, via RLS. */
export async function fetchLinkNotices(groupId: string): Promise<MemberLinkNotice[]> {
  const { data, error } = await supabase
    .from('member_link_notices')
    .select('event_id, kind, member_name, phone_e164, created_at')
    .eq('group_id', groupId)
    .is('acknowledged_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    eventId: row.event_id as string,
    kind: row.kind as 'linked' | 'ambiguous',
    memberName: row.member_name ?? null,
    phone: row.phone_e164 as string,
    createdAt: row.created_at as string,
  }));
}

export async function acknowledgeLinkNotice(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('acknowledge_member_link', { p_event_id: eventId });
  if (error) throw error;
}
