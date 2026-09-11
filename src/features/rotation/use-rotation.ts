import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { expenseKeys } from '@/features/expenses/use-expenses';
import { planKeys } from '@/features/plans/use-plans';

import {
  appendToRotation,
  assignRotation,
  fetchRotation,
  fetchSlotArrears,
  recordPayout,
  replaceRotationMember,
  reversePayout,
} from './api';

export const rotationKeys = {
  all: ['rotation'] as const,
  list: (planId: string) => [...rotationKeys.all, 'list', planId] as const,
  arrears: (planId: string, memberId: string) =>
    [...rotationKeys.all, 'arrears', planId, memberId] as const,
};

export function useRotation(planId: string | undefined) {
  return useQuery({
    queryKey: rotationKeys.list(planId ?? ''),
    queryFn: () => fetchRotation(planId!),
    enabled: Boolean(planId),
  });
}

export function useSlotArrears(planId: string | undefined, memberId: string | undefined) {
  return useQuery({
    queryKey: rotationKeys.arrears(planId ?? '', memberId ?? ''),
    queryFn: () => fetchSlotArrears(planId!, memberId!),
    enabled: Boolean(planId) && Boolean(memberId),
  });
}

/**
 * A payout moves money out and may settle contributions on the way, so it
 * touches the rotation, the plan, expenses and the group balance at once.
 */
function useRotationMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rotationKeys.all });
      queryClient.invalidateQueries({ queryKey: planKeys.all });
      queryClient.invalidateQueries({ queryKey: expenseKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useAssignRotation() {
  return useRotationMutation(assignRotation);
}

export function useAppendToRotation() {
  return useRotationMutation(appendToRotation);
}

export function useReplaceRotationMember() {
  return useRotationMutation(replaceRotationMember);
}

export function useRecordPayout() {
  return useRotationMutation(recordPayout);
}

export function useReversePayout() {
  return useRotationMutation(reversePayout);
}
