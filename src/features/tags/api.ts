import { supabase } from '@/lib/supabase';

/** Chips have to be legible on a pale card, so these are all mid-dark. */
export const TAG_COLOURS = [
  '#0B7A5C',
  '#1D4ED8',
  '#B45309',
  '#7C3AED',
  '#BE123C',
  '#0F766E',
  '#4D7C0F',
  '#475569',
] as const;

export const DEFAULT_TAG_COLOUR = TAG_COLOURS[0];

export interface TagRow {
  id: string;
  name: string;
  colour: string;
  memberCount: number;
  /** Contributions scoped to this tag. A tag in use cannot be deleted. */
  planCount: number;
}

export async function fetchTags(groupId: string): Promise<TagRow[]> {
  const { data, error } = await supabase
    .from('tag_summaries')
    .select('tag_id, name, colour, member_count, plan_count')
    .eq('group_id', groupId)
    .order('name');

  if (error) throw error;

  // A view carries no NOT NULL information, so every column types as nullable.
  return (data ?? []).map((row: any) => ({
    id: row.tag_id as string,
    name: row.name as string,
    colour: row.colour as string,
    memberCount: Number(row.member_count ?? 0),
    planCount: Number(row.plan_count ?? 0),
  }));
}

/** The member ids carrying a tag, for the checklist on the tag screen. */
export async function fetchTagMembers(tagId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('member_tags')
    .select('member_id')
    .eq('tag_id', tagId);

  if (error) throw error;
  return (data ?? []).map((row) => row.member_id);
}

/** Every tag carried by every member of a group, keyed by member id. */
export async function fetchTagsByMember(groupId: string): Promise<Record<string, TagRow[]>> {
  const [tagsResult, linksResult] = await Promise.all([
    fetchTags(groupId),
    supabase
      .from('member_tags')
      .select('tag_id, member_id, tags!inner(group_id)')
      .eq('tags.group_id', groupId),
  ]);

  if (linksResult.error) throw linksResult.error;

  const byId = new Map(tagsResult.map((tag) => [tag.id, tag]));
  const result: Record<string, TagRow[]> = {};

  for (const link of linksResult.data ?? []) {
    const tag = byId.get(link.tag_id);
    if (!tag) continue;
    (result[link.member_id] ??= []).push(tag);
  }

  return result;
}

export async function createTag(input: { groupId: string; name: string; colour?: string }) {
  const { data, error } = await supabase.rpc('create_tag', {
    p_group_id: input.groupId,
    p_name: input.name,
    p_colour: input.colour ?? DEFAULT_TAG_COLOUR,
  });

  if (error) throw error;
  return data;
}

export async function renameTag(input: { tagId: string; name?: string; colour?: string }) {
  const { data, error } = await supabase.rpc('rename_tag', {
    p_tag_id: input.tagId,
    // Optional RPC arguments must be omitted, not sent as null: the parameter
    // has a Postgres DEFAULT and `undefined` drops the key from the request.
    p_name: input.name ?? undefined,
    p_colour: input.colour ?? undefined,
  });

  if (error) throw error;
  return data;
}

export async function deleteTag(tagId: string) {
  const { error } = await supabase.rpc('delete_tag', { p_tag_id: tagId });
  if (error) throw error;
}

export interface SetTagMembersInput {
  tagId: string;
  memberIds: string[];
  /**
   * Bill someone joining the tag for periods that closed before they joined.
   * Whether a new executive owes the back months is the group's decision, not
   * ours — the same question add_member asks.
   */
  includePastPeriods?: boolean;
}

export async function setTagMembers(input: SetTagMembersInput) {
  const { data, error } = await supabase.rpc('set_tag_members', {
    p_tag_id: input.tagId,
    p_member_ids: input.memberIds,
    p_include_past_periods: input.includePastPeriods ?? false,
  });

  if (error) throw error;
  return data;
}

export async function setMemberTags(input: {
  memberId: string;
  tagIds: string[];
  includePastPeriods?: boolean;
}) {
  const { data, error } = await supabase.rpc('set_member_tags', {
    p_member_id: input.memberId,
    p_tag_ids: input.tagIds,
    p_include_past_periods: input.includePastPeriods ?? false,
  });

  if (error) throw error;
  return data;
}

export interface PlanTagAmountRow {
  tagId: string;
  tagName: string;
  tagColour: string;
  /** Minor units. What members carrying this tag pay, instead of the default. */
  amount: number;
  /** Lowest wins when a member carries more than one priced tag. */
  rank: number;
  memberCount: number;
}

export async function fetchPlanTagAmounts(planId: string): Promise<PlanTagAmountRow[]> {
  const { data, error } = await supabase
    .from('plan_tag_amount_details')
    .select('tag_id, tag_name, tag_colour, amount, rank, member_count')
    .eq('plan_id', planId)
    .order('rank');

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    tagId: row.tag_id as string,
    tagName: row.tag_name as string,
    tagColour: row.tag_colour as string,
    amount: Number(row.amount ?? 0),
    rank: Number(row.rank ?? 100),
    memberCount: Number(row.member_count ?? 0),
  }));
}

export async function setPlanTagAmount(input: {
  planId: string;
  tagId: string;
  amount: number;
  rank?: number;
}) {
  const { data, error } = await supabase.rpc('set_plan_tag_amount', {
    p_plan_id: input.planId,
    p_tag_id: input.tagId,
    p_amount: input.amount,
    p_rank: input.rank ?? undefined,
  });

  if (error) throw error;
  return data;
}

export async function clearPlanTagAmount(input: { planId: string; tagId: string }) {
  const { error } = await supabase.rpc('clear_plan_tag_amount', {
    p_plan_id: input.planId,
    p_tag_id: input.tagId,
  });

  if (error) throw error;
}

/** Points a contribution at a tag, or back at the whole group with `null`. */
export async function setPlanAudience(input: { planId: string; tagId: string | null }) {
  const { data, error } = await supabase.rpc('set_plan_audience', {
    p_plan_id: input.planId,
    p_tag_id: input.tagId ?? undefined,
  });

  if (error) throw error;
  return data;
}
