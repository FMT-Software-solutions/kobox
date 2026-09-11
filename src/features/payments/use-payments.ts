import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { memberKeys } from '@/features/members/use-members';

import {
  confirmPayment,
  fetchMemberPayments,
  fetchOutstanding,
  recordPayment,
  reversePayment,
} from './api';

export const paymentKeys = {
  all: ['payments'] as const,
  outstanding: (groupId: string, memberId: string) =>
    [...paymentKeys.all, 'outstanding', groupId, memberId] as const,
  history: (memberId: string) => [...paymentKeys.all, 'history', memberId] as const,
};

export function useMemberPayments(memberId: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.history(memberId ?? ''),
    queryFn: () => fetchMemberPayments(memberId!),
    enabled: Boolean(memberId),
  });
}

export function useOutstanding(groupId: string | undefined, memberId: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.outstanding(groupId ?? '', memberId ?? ''),
    queryFn: () => fetchOutstanding(groupId!, memberId!),
    enabled: Boolean(groupId) && Boolean(memberId),
  });
}

/** Money moving invalidates balances, member standings and the dashboard alike. */
function useLedgerMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
    },
  });
}

export function useRecordPayment() {
  return useLedgerMutation(recordPayment);
}

export function useConfirmPayment() {
  return useLedgerMutation(confirmPayment);
}

export function useReversePayment() {
  return useLedgerMutation(reversePayment);
}
