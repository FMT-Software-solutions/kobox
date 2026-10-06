import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile networks are unreliable and often slow. Serve cached data
      // immediately and revalidate underneath rather than showing spinners.
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
      // React Native has no window focus; refetch is driven by app state
      // instead. A browser does, and it is the only refresh the web build has:
      // pull-to-refresh does not exist there, so coming back to the tab is what
      // picks up a payment somebody else recorded.
      refetchOnWindowFocus: Platform.OS === 'web',
    },
    mutations: {
      retry: 0,
    },
  },
});
