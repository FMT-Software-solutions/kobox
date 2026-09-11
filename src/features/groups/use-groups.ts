import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createGroup, fetchMyMemberships, joinGroup } from './api';

export const groupKeys = {
  all: ['groups'] as const,
  memberships: () => [...groupKeys.all, 'memberships'] as const,
};

export function useMyMemberships() {
  return useQuery({
    queryKey: groupKeys.memberships(),
    queryFn: fetchMyMemberships,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}

export function useJoinGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: joinGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}
