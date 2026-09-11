import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { memberKeys } from '@/features/members/use-members';

import {
  approveJoinRequest,
  declineJoinRequest,
  fetchInviteSettings,
  fetchJoinRequests,
  fetchMyJoinRequests,
  regenerateJoinCode,
  setJoinPolicy,
} from './membership-api';
import { groupKeys } from './use-groups';

export const membershipKeys = {
  all: ['membership'] as const,
  invite: (groupId: string) => [...membershipKeys.all, 'invite', groupId] as const,
  requests: (groupId: string) => [...membershipKeys.all, 'requests', groupId] as const,
  mine: () => [...membershipKeys.all, 'my-requests'] as const,
};

export function useInviteSettings(groupId: string | undefined) {
  return useQuery({
    queryKey: membershipKeys.invite(groupId ?? ''),
    queryFn: () => fetchInviteSettings(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useJoinRequests(groupId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: membershipKeys.requests(groupId ?? ''),
    queryFn: () => fetchJoinRequests(groupId!),
    enabled: Boolean(groupId) && enabled,
  });
}

export function useMyJoinRequests(enabled = true) {
  return useQuery({
    queryKey: membershipKeys.mine(),
    queryFn: fetchMyJoinRequests,
    enabled,
  });
}

/**
 * Approving turns a request into a billed member — and may fold it into an
 * existing record — so the member list, every balance and the dashboard all
 * move at once.
 */
function useMembershipMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: membershipKeys.all });
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useRegenerateJoinCode() {
  return useMembershipMutation(regenerateJoinCode);
}

export function useSetJoinPolicy() {
  return useMembershipMutation(setJoinPolicy);
}

export function useApproveJoinRequest() {
  return useMembershipMutation(approveJoinRequest);
}

export function useDeclineJoinRequest() {
  return useMembershipMutation(declineJoinRequest);
}
