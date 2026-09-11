import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deleteMyAccount, fetchDeletionPreview } from './api';

export const accountKeys = {
  deletionPreview: (userId: string) => ['account', 'deletion-preview', userId] as const,
};

/** Keyed by user, so signing in as somebody else on the same page never shows the last person's groups. */
export function useDeletionPreview(userId: string | undefined) {
  return useQuery({
    queryKey: accountKeys.deletionPreview(userId ?? ''),
    queryFn: fetchDeletionPreview,
    enabled: Boolean(userId),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMyAccount,
    // Nothing cached about a deleted account is worth keeping on the device.
    onSuccess: () => queryClient.clear(),
  });
}
