import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { smsKeys } from '@/features/sms/use-sms';

import { fetchMessageHistory, previewMessage, sendMessage, type Audience } from './api';

export const messageKeys = {
  all: ['messages'] as const,
  history: (groupId: string) => [...messageKeys.all, 'history', groupId] as const,
  preview: (groupId: string, body: string, audience: Audience) =>
    [...messageKeys.all, 'preview', groupId, body, audience] as const,
};

export function useMessageHistory(groupId: string | undefined) {
  return useQuery({
    queryKey: messageKeys.history(groupId ?? ''),
    queryFn: () => fetchMessageHistory(groupId!),
    enabled: Boolean(groupId),
  });
}

/**
 * The composer's running estimate.
 *
 * Asked of the SERVER, not computed on the phone: the preview and the send use
 * one definition of the audience and one estimate of the cost, so what the
 * admin is shown is what will be charged. Pass a debounced body — the counter
 * under the text box is local; this is the answer to "can we afford it".
 * `keepPreviousData` holds the last answer on screen while the next one loads,
 * so the figures do not flicker to zero on every keystroke.
 */
export function useMessagePreview(
  groupId: string | undefined,
  body: string,
  audience: Audience,
  enabled: boolean
) {
  return useQuery({
    queryKey: messageKeys.preview(groupId ?? '', body, audience),
    queryFn: () => previewMessage({ groupId: groupId!, body, audience }),
    enabled: Boolean(groupId) && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sendMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: messageKeys.all });
      // Credits move once the dispatcher runs; the balance screen should not
      // show the old figure when the admin goes to look.
      queryClient.invalidateQueries({ queryKey: smsKeys.all });
    },
  });
}
