import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { groupKeys } from '@/features/groups/use-groups';
import { memberKeys } from '@/features/members/use-members';

import { acknowledgeLinkNotice, claimMemberships, fetchLinkNotices } from './linking';

export const linkKeys = {
  all: ['member-links'] as const,
  notices: (groupId: string) => [...linkKeys.all, 'notices', groupId] as const,
};

export function useLinkNotices(groupId: string | undefined) {
  return useQuery({
    queryKey: linkKeys.notices(groupId ?? ''),
    queryFn: () => fetchLinkNotices(groupId!),
    enabled: Boolean(groupId),
  });
}

export function useAcknowledgeLinkNotice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: acknowledgeLinkNotice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: linkKeys.all }),
  });
}

/**
 * Runs the claim once per signed-in session and refreshes the group list if it
 * found anything.
 *
 * A query rather than an effect: TanStack already owns "do this once, cache the
 * result, do not stampede", and React Compiler rejects setState-in-effect. A
 * failure is swallowed — a member who cannot be linked right now should still
 * reach the app, not a blank screen.
 */
export function useClaimMemberships(enabled: boolean) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [...linkKeys.all, 'claim'] as const,
    queryFn: async () => {
      try {
        const claimed = await claimMemberships();
        if (claimed > 0) {
          await queryClient.invalidateQueries({ queryKey: groupKeys.all });
          await queryClient.invalidateQueries({ queryKey: memberKeys.all });
        }
        return claimed;
      } catch {
        return 0;
      }
    },
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}
