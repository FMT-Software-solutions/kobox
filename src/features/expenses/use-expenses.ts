import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';

import { approveExpense, fetchExpenses, recordExpense, rejectExpense, voidExpense } from './api';

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (groupId: string) => [...expenseKeys.all, 'list', groupId] as const,
};

export function useExpenses(groupId: string | undefined) {
  return useQuery({
    queryKey: expenseKeys.list(groupId ?? ''),
    queryFn: () => fetchExpenses(groupId!),
    enabled: Boolean(groupId),
  });
}

/** Anything touching an expense moves the group balance, so refresh both. */
function useExpenseMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useRecordExpense() {
  return useExpenseMutation(recordExpense);
}

export function useApproveExpense() {
  return useExpenseMutation(approveExpense);
}

export function useRejectExpense() {
  return useExpenseMutation(rejectExpense);
}

export function useVoidExpense() {
  return useExpenseMutation(voidExpense);
}
