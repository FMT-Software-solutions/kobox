import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchPreferences, savePreferences } from './api';

export const notificationKeys = {
  all: ['notifications'] as const,
  preferences: (memberId: string) => [...notificationKeys.all, 'preferences', memberId] as const,
};

export function usePreferences(memberId: string | undefined) {
  return useQuery({
    queryKey: notificationKeys.preferences(memberId ?? ''),
    queryFn: () => fetchPreferences(memberId!),
    enabled: Boolean(memberId),
  });
}

export function useSavePreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: savePreferences,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
