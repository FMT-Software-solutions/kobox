import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { memberKeys } from '@/features/members/use-members';

import { clearPlanOverride, fetchPlanOverrides, setPlanOverride } from './overrides-api';
import { planKeys } from './use-plans';

export const overrideKeys = {
  all: ['plan-overrides'] as const,
  list: (planId: string) => [...overrideKeys.all, 'list', planId] as const,
};

export function usePlanOverrides(planId: string | undefined) {
  return useQuery({
    queryKey: overrideKeys.list(planId ?? ''),
    queryFn: () => fetchPlanOverrides(planId!),
    enabled: Boolean(planId),
  });
}

/**
 * Setting an override reissues and reprices the plan, so the member's standing,
 * the plan totals and the dashboard all move together. Same invalidation set as
 * a tag amount, for the same reason.
 */
function useOverrideMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overrideKeys.all });
      queryClient.invalidateQueries({ queryKey: planKeys.all });
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useSetPlanOverride() {
  return useOverrideMutation(setPlanOverride);
}

export function useClearPlanOverride() {
  return useOverrideMutation(clearPlanOverride);
}
