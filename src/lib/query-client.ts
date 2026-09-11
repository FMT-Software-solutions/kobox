import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mobile networks are unreliable and often slow. Serve cached data
      // immediately and revalidate underneath rather than showing spinners.
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
      // React Native has no window focus; refetch is driven by app state instead.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
