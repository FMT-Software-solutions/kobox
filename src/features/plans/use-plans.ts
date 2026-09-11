import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';

import { createPlan, deletePlan, fetchPlan, fetchPlans, fetchPlanSummary, updatePlan } from './api';

export const planKeys = {
  all: ['plans'] as const,
  list: (groupId: string) => [...planKeys.all, 'list', groupId] as const,
  detail: (planId: string) => [...planKeys.all, 'detail', planId] as const,
  summary: (planId: string) => [...planKeys.all, 'summary', planId] as const,
};

export function usePlans(groupId: string | undefined) {
  return useQuery({
    queryKey: planKeys.list(groupId ?? ''),
    queryFn: () => fetchPlans(groupId!),
    enabled: Boolean(groupId),
  });
}

export function usePlan(planId: string | undefined) {
  return useQuery({
    queryKey: planKeys.detail(planId ?? ''),
    queryFn: () => fetchPlan(planId!),
    enabled: Boolean(planId),
  });
}

export function usePlanSummary(planId: string | undefined) {
  return useQuery({
    queryKey: planKeys.summary(planId ?? ''),
    queryFn: () => fetchPlanSummary(planId!),
    enabled: Boolean(planId),
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePlan,
    onSuccess: () => {
      // Moving the start date backfills cycles, so obligations change too.
      queryClient.invalidateQueries({ queryKey: planKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPlan,
    onSuccess: () => {
      // A new plan issues obligations, so the dashboard's standing and summary
      // are both stale now.
      queryClient.invalidateQueries({ queryKey: planKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}
