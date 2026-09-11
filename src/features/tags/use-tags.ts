import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { memberKeys } from '@/features/members/use-members';
import { planKeys } from '@/features/plans/use-plans';

import {
  clearPlanTagAmount,
  createTag,
  deleteTag,
  fetchPlanTagAmounts,
  fetchTagMembers,
  fetchTags,
  fetchTagsByMember,
  renameTag,
  setMemberTags,
  setPlanAudience,
  setPlanTagAmount,
  setTagMembers,
} from './api';

export const tagKeys = {
  all: ['tags'] as const,
  list: (groupId: string) => [...tagKeys.all, 'list', groupId] as const,
  members: (tagId: string) => [...tagKeys.all, 'members', tagId] as const,
  byMember: (groupId: string) => [...tagKeys.all, 'by-member', groupId] as const,
  planAmounts: (planId: string) => [...tagKeys.all, 'plan-amounts', planId] as const,
};

export function useTags(groupId: string | undefined) {
  return useQuery({
    queryKey: tagKeys.list(groupId ?? ''),
    queryFn: () => fetchTags(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useTagMembers(tagId: string | undefined) {
  return useQuery({
    queryKey: tagKeys.members(tagId ?? ''),
    queryFn: () => fetchTagMembers(tagId!),
    enabled: Boolean(tagId),
  });
}

export function useTagsByMember(groupId: string | undefined) {
  return useQuery({
    queryKey: tagKeys.byMember(groupId ?? ''),
    queryFn: () => fetchTagsByMember(groupId!),
    enabled: Boolean(groupId),
  });
}

/**
 * Changing a tag's membership issues or waives obligations on every
 * contribution scoped to it, so balances, plan totals and the dashboard all
 * move at once. Naming and colour changes go through the same invalidation —
 * cheap, and it keeps one rule instead of two.
 */
function useTagMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
      queryClient.invalidateQueries({ queryKey: planKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useCreateTag() {
  return useTagMutation(createTag);
}

export function useRenameTag() {
  return useTagMutation(renameTag);
}

export function useDeleteTag() {
  return useTagMutation(deleteTag);
}

export function useSetTagMembers() {
  return useTagMutation(setTagMembers);
}

export function useSetMemberTags() {
  return useTagMutation(setMemberTags);
}

export function useSetPlanAudience() {
  return useTagMutation(setPlanAudience);
}

export function usePlanTagAmounts(planId: string | undefined) {
  return useQuery({
    queryKey: tagKeys.planAmounts(planId ?? ''),
    queryFn: () => fetchPlanTagAmounts(planId!),
    enabled: Boolean(planId),
  });
}

export function useSetPlanTagAmount() {
  return useTagMutation(setPlanTagAmount);
}

export function useClearPlanTagAmount() {
  return useTagMutation(clearPlanTagAmount);
}
