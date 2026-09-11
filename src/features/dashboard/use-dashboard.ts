import { useQuery } from '@tanstack/react-query';

import { fetchGroupSummary, fetchMyStanding, fetchRecentPayments } from './api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: (groupId: string) => [...dashboardKeys.all, 'summary', groupId] as const,
  payments: (groupId: string) => [...dashboardKeys.all, 'payments', groupId] as const,
  standing: (memberId: string) => [...dashboardKeys.all, 'standing', memberId] as const,
};

export function useGroupSummary(groupId: string | undefined) {
  return useQuery({
    queryKey: dashboardKeys.summary(groupId ?? ''),
    queryFn: () => fetchGroupSummary(groupId!),
    enabled: Boolean(groupId),
  });
}

/**
 * Pass `memberId` to get only that member's payments.
 *
 * It is part of the query key, not just the request — the group-wide list and
 * one member's list are different answers and must never share a cache entry.
 */
export function useRecentPayments(groupId: string | undefined, memberId?: string) {
  return useQuery({
    queryKey: [...dashboardKeys.payments(groupId ?? ''), memberId ?? 'all'] as const,
    queryFn: () => fetchRecentPayments(groupId!, 10, memberId),
    enabled: Boolean(groupId),
  });
}

export function useMyStanding(memberId: string | undefined) {
  return useQuery({
    queryKey: dashboardKeys.standing(memberId ?? ''),
    queryFn: () => fetchMyStanding(memberId!),
    enabled: Boolean(memberId),
  });
}
