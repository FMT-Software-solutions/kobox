import type { PlanFrequency, PlanKind, PlanStatus } from '@/lib/domain';
import type { Minor } from '@/lib/money';
import { supabase } from '@/lib/supabase';

export interface PlanRow {
  id: string;
  name: string;
  kind: PlanKind;
  frequency: PlanFrequency;
  status: PlanStatus;
  defaultAmount: Minor | null;
  graceDays: number;
  startDate: string;
  /** The tag this contribution is for, or null when it is for everyone. */
  audienceTagId: string | null;
}

const PLAN_COLUMNS =
  'id, name, kind, frequency, status, default_amount, grace_days, start_date, audience_tag_id';

function toPlanRow(row: any): PlanRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    frequency: row.frequency,
    status: row.status,
    defaultAmount: row.default_amount === null ? null : Number(row.default_amount),
    graceDays: Number(row.grace_days ?? 0),
    startDate: row.start_date,
    audienceTagId: row.audience_tag_id ?? null,
  };
}

export interface CreatePlanInput {
  groupId: string;
  name: string;
  kind: PlanKind;
  frequency: PlanFrequency;
  /** Minor units. Null only for `open` plans. */
  defaultAmount: Minor | null;
  graceDays: number;
  /** `YYYY-MM-DD`. Every period from here to today is opened on creation. */
  startDate: string;
  /** Closing date. Only meaningful for one-off collections. */
  endDate?: string | null;
  /** Bill only the members carrying this tag. Omit or null for everyone. */
  audienceTagId?: string | null;
}

export async function createPlan(input: CreatePlanInput) {
  const { data, error } = await supabase.rpc('create_plan', {
    p_group_id: input.groupId,
    p_name: input.name,
    p_kind: input.kind,
    p_frequency: input.frequency,
    // Omitted rather than null for `open` plans — see the note in members/api.ts.
    p_default_amount: input.defaultAmount ?? undefined,
    p_grace_days: input.graceDays,
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? undefined,
    p_audience_tag_id: input.audienceTagId ?? undefined,
  });

  if (error) throw error;
  return data;
}

export interface UpdatePlanInput {
  planId: string;
  name?: string;
  defaultAmount?: Minor | null;
  graceDays?: number;
  /** `YYYY-MM-DD`. May only move earlier; the database refuses a later date. */
  startDate?: string;
  status?: PlanStatus;
}

export async function updatePlan(input: UpdatePlanInput) {
  const { data, error } = await supabase.rpc('update_plan', {
    p_plan_id: input.planId,
    p_name: input.name ?? undefined,
    p_default_amount: input.defaultAmount ?? undefined,
    p_grace_days: input.graceDays ?? undefined,
    p_start_date: input.startDate ?? undefined,
    p_status: input.status ?? undefined,
  });

  if (error) throw error;
  return data;
}

export async function deletePlan(planId: string) {
  const { error } = await supabase.rpc('delete_plan', { p_plan_id: planId });
  if (error) throw error;
}

export interface PlanSummary {
  cycleCount: number;
  totalExpected: Minor;
  totalCollected: Minor;
  extraGiving: Minor;
  /** True once any payment is attached — deleting is impossible from here on. */
  hasMoney: boolean;
}

export async function fetchPlanSummary(planId: string): Promise<PlanSummary> {
  const { data, error } = await supabase
    .from('plan_summaries')
    .select('cycle_count, total_expected, total_collected, extra_giving, has_money')
    .eq('plan_id', planId)
    .single();

  if (error) throw error;

  return {
    cycleCount: Number(data.cycle_count ?? 0),
    totalExpected: Number(data.total_expected ?? 0),
    totalCollected: Number(data.total_collected ?? 0),
    extraGiving: Number(data.extra_giving ?? 0),
    hasMoney: Boolean(data.has_money),
  };
}

export async function fetchPlan(planId: string): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .single();

  if (error) throw error;
  return toPlanRow(data);
}

export async function fetchPlans(groupId: string): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLUMNS)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(toPlanRow);
}
