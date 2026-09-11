import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

/**
 * What one member pays on one contribution — step 2 of the resolution chain in
 * `plan_obligation_amount`, beaten only by the audience test itself.
 */
export interface PlanOverrideRow {
  memberId: string;
  memberName: string;
  /** Null means exempt: they are not billed for this contribution at all. */
  amount: Minor | null;
  reason: string | null;
}

export async function fetchPlanOverrides(planId: string): Promise<PlanOverrideRow[]> {
  const { data, error } = await supabase
    .from('plan_member_overrides')
    .select('member_id, amount, reason, group_members!inner(full_name)')
    .eq('plan_id', planId);

  if (error) throw error;

  return (data ?? [])
    .map((row: any) => ({
      memberId: row.member_id as string,
      memberName: (row.group_members?.full_name ?? 'Unknown member') as string,
      // A view/embed column is nullable in the generated types, but here null
      // is the meaningful "exempt" value rather than missing data.
      amount: row.amount === null ? null : Number(row.amount),
      reason: row.reason,
    }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
}

export interface SetPlanOverrideInput {
  planId: string;
  memberId: string;
  /** Null exempts them from this contribution. */
  amount: Minor | null;
  reason?: string;
}

export async function setPlanOverride(input: SetPlanOverrideInput) {
  // Optional RPC arguments are omitted, never sent as null: Postgres DEFAULT
  // parameters type as `number | undefined`, so the generated types reject a
  // null outright. That works in our favour here — `p_amount` defaults to NULL
  // in SQL and NULL is precisely what "exempt" means, so leaving it out sends
  // the exact value we want rather than fighting the type.
  const { data, error } = await supabase.rpc('set_plan_override', {
    p_plan_id: input.planId,
    p_member_id: input.memberId,
    ...(input.amount === null ? {} : { p_amount: input.amount }),
    ...(input.reason ? { p_reason: input.reason } : {}),
  });

  if (error) throw error;
  return data;
}

export async function clearPlanOverride(input: { planId: string; memberId: string }) {
  const { error } = await supabase.rpc('clear_plan_override', {
    p_plan_id: input.planId,
    p_member_id: input.memberId,
  });

  if (error) throw error;
}
