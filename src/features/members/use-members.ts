import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { groupKeys } from '@/features/groups/use-groups';

import { addMember, fetchMembers, setMemberRole } from './api';

export const memberKeys = {
  all: ['members'] as const,
  list: (groupId: string) => [...memberKeys.all, 'list', groupId] as const,
};

export function useMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: memberKeys.list(groupId ?? ''),
    queryFn: () => fetchMembers(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useAddMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addMember,
    onSuccess: () => {
      // A new member is issued obligations for open cycles, so the group's
      // outstanding total and member count both move.
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

/**
 * Roles gate what someone can see as well as do, so a change has to reach the
 * membership list (which carries the role the whole app reads) as well as the
 * member rows themselves.
 */
export function useSetMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setMemberRole,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
    },
  });
}
