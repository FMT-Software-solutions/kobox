import { useQuery } from '@tanstack/react-query';
import { useColorScheme } from 'react-native';

import { loadAppearance } from './appearance';

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
export function useIsDark(): boolean {
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
