import { useQuery } from '@tanstack/react-query';

import { registerPushToken } from './push';

/**
 * Registers this device once per signed-in session.
 *
 * A query rather than an effect: TanStack already owns "do this once, cache it,
 * do not stampede", and React Compiler rejects setState-in-effect. Failure is
 * swallowed inside `registerPushToken`, so a denied permission never blocks a
 * launch.
 */
export function useRegisterPush(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications', 'push-token'] as const,
    queryFn: registerPushToken,
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}
