import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/features/auth/session-provider';

/** Auth screens are only reachable when signed out. */
export default function AuthLayout() {
  const { session } = useSession();

  if (session) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
