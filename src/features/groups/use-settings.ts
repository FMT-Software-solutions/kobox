import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearGroupLogo,
  fetchGroupProfile,
  updateGroupProfile,
  uploadGroupLogo,
} from './settings-api';
import { groupKeys } from './use-groups';

export const settingsKeys = {
  profile: (groupId: string) => [...groupKeys.all, 'profile', groupId] as const,
};

export function useGroupProfile(groupId: string | undefined) {
  return useQuery({
    queryKey: settingsKeys.profile(groupId ?? ''),
    queryFn: () => fetchGroupProfile(groupId!),
    enabled: Boolean(groupId),
  });
}

/**
 * Every change here invalidates ALL group queries, not just the profile. The
 * name, logo and brand colour also ride on the membership list — that is what
 * the dashboard header, the group switcher and the brand scope read — and a
 * rename that only updated the settings screen would look like it had failed.
 */
function useGroupMutation<T>(fn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}

export function useUpdateGroupProfile() {
  return useGroupMutation(updateGroupProfile);
}

export function useUploadGroupLogo() {
  return useGroupMutation(uploadGroupLogo);
}

export function useClearGroupLogo() {
  return useGroupMutation(clearGroupLogo);
}
