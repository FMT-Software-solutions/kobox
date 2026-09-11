import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/features/dashboard/use-dashboard';
import { groupKeys } from '@/features/groups/use-groups';
import { memberKeys } from '@/features/members/use-members';

import { clearMyAvatar, fetchMyProfile, setMyName, uploadMyAvatar } from './api';

export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
};

export function useMyProfile() {
  return useQuery({ queryKey: profileKeys.me(), queryFn: fetchMyProfile });
}

/**
 * Setting your name can rename your `group_members` rows — it repairs the
 * 'Owner' / 'Member' placeholders a phone sign-up leaves behind — so the member
 * lists, the dashboard and every membership label are all stale afterwards.
 */
function useProfileMutation<TArgs, TResult>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.all });
      queryClient.invalidateQueries({ queryKey: memberKeys.all });
      queryClient.invalidateQueries({ queryKey: groupKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
}

export function useSetMyName() {
  return useProfileMutation(setMyName);
}

export function useUploadMyAvatar() {
  return useProfileMutation(uploadMyAvatar);
}

/**
 * Explicit type arguments because `clearMyAvatar` takes none: without them
 * `TArgs` infers as `unknown` and `.mutate()` is a type error at every call.
 */
export function useClearMyAvatar() {
  return useProfileMutation<void, void>(() => clearMyAvatar());
}
