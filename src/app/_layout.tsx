import '@/global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '@/features/auth/session-provider';
import { applyAppearance, loadAppearance } from '@/lib/appearance';
import { queryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();

// Before the first render that matters, so a phone set to dark does not flash
// light on every launch. Fire and forget: the default is "follow the phone",
// which is also what happens if storage cannot be read.
loadAppearance()
  .then(applyAppearance)
  .catch(() => {});

/**
 * Holds the splash screen until we know whether the user is signed in. Without
 * this the app renders the sign-in screen for a frame before redirecting an
 * already-authenticated member to the dashboard.
 */
function SplashGate({ children }: { children: React.ReactNode }) {
  const { isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  if (isLoading) return null;
  return <>{children}</>;
}

export default function RootLayout() {
  const isDark = useColorScheme() === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
              <SplashGate>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(app)" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(public)" />
                </Stack>
              </SplashGate>
              <StatusBar style={isDark ? 'light' : 'dark'} />
            </ThemeProvider>
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
