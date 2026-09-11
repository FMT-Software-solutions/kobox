import '@/global.css';

import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '@/features/auth/session-provider';
import { applyAppearance, loadAppearance } from '@/lib/appearance';
import { queryClient } from '@/lib/query-client';

const IS_WEB = Platform.OS === 'web';

/**
 * The app is designed for a phone. On a laptop, stretching every screen to
 * the window's width made the sign-in cards two metres wide, so the web build
 * renders the app in a centred column of phone-to-tablet width. Native is left
 * untouched — this wrapper does not exist there.
 */
const WEB_COLUMN = 560;

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

/**
 * One answer to "is this dark?", used by EVERYTHING that paints.
 *
 * The navigation theme, the status bar and NativeWind's colour tokens used to
 * decide separately. On a phone they agree, because NativeWind's
 * `colorScheme.set` also moves React Native's Appearance. On the web they did
 * not: React Native read the BROWSER's dark mode while the tokens stayed light,
 * so a dark browser showed a black page with white cards and near-invisible
 * dark text on it — and the next screen, which paints its own background,
 * suddenly light.
 *
 * The rule is the user's choice first, then the device. On the web the tokens
 * are switched by the `dark` class `global.css` keys on (`.dark:root`), which
 * nothing else sets there.
 */
function useIsDark(): boolean {
  const deviceScheme = useColorScheme();
  // Settings writes the choice straight into this key, so it updates live.
  const { data: mode } = useQuery({
    queryKey: ['appearance'],
    queryFn: loadAppearance,
    staleTime: Infinity,
  });

  const choice = mode ?? 'system';
  return choice === 'system' ? deviceScheme === 'dark' : choice === 'dark';
}

function ThemedApp() {
  const isDark = useIsDark();

  useEffect(() => {
    if (!IS_WEB || typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDark);
    // Form controls and scrollbars follow too, instead of staying light.
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [isDark]);

  const stack = (
    <SplashGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(public)" />
      </Stack>
    </SplashGate>
  );

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      {IS_WEB ? (
        <View className="flex-1 bg-background">
          <View
            className="flex-1 border-x border-border bg-background"
            style={{ width: '100%', maxWidth: WEB_COLUMN, alignSelf: 'center' }}>
            {stack}
          </View>
        </View>
      ) : (
        stack
      )}
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <ThemedApp />
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
