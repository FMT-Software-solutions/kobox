import { supabase } from '@/lib/supabase';

export interface MembershipWithGroup {
  memberId: string;
  role: string;
  groupId: string;
  groupName: string;
  joinCode: string;
  currency: string;
  /** Carried on the membership so the brand and logo apply on the first frame. */
  logoUrl: string | null;
  brandColour: string | null;
}

/** Every group the signed-in user actively belongs to. */
export async function fetchMyMemberships(): Promise<MembershipWithGroup[]> {
  // Filtering by user_id is not optional. RLS lets a member SELECT every row in
  // their own groups, so without this the query returns the whole membership
  // list of every group — other people's rows included — and memberships[0]
  // becomes whichever row Postgres happened to return first. That row drives
  // the dashboard standing, the statement screen and who a payment is recorded
  // against, so it must be the signed-in user's own.
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) return [];

  const { data, error } = await supabase
    .from('group_members')
    .select(
      'id, role, group_id, groups!inner(id, name, join_code, currency, logo_url, brand_colour)'
    )
    .eq('user_id', auth.user.id)
    .eq('status', 'active')
    // Stable order, so the default group does not change between launches.
    .order('created_at');

  if (error) throw error;

  return (data ?? []).map((row) => {
    // Supabase types an embedded to-one relation as an object; the !inner join
    // guarantees it is present.
    const group = row.groups as unknown as {
      id: string;
      name: string;
      join_code: string;
      currency: string;
      logo_url: string | null;
      brand_colour: string | null;
    };

    return {
      memberId: row.id,
      role: row.role,
      groupId: group.id,
      groupName: group.name,
      joinCode: group.join_code,
      currency: group.currency,
      logoUrl: group.logo_url,
      brandColour: group.brand_colour,
    };
  });
}

export async function createGroup(input: { name: string; currency?: string }) {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: input.name,
    p_currency: input.currency ?? 'GHS',
  });

  if (error) throw error;
  return data;
}

export async function joinGroup(joinCode: string) {
  const { data, error } = await supabase.rpc('join_group', { p_join_code: joinCode });

  if (error) throw error;
  return data;
}
