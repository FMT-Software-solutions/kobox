/**
 * Light, dark, or follow the phone — a per-DEVICE choice.
 *
 * Deliberately not stored on the account or the group: the same person may
 * want a dark app on the phone they read in bed and a light one on the tablet
 * at the meeting, and a group has no business deciding either for them.
 *
 * NativeWind's `colorScheme.set` switches the `.dark:root` tokens in
 * `global.css` and, on native, React Native's own Appearance with them — so the
 * navigation theme and the status bar, which read `useColorScheme()`, follow.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { colorScheme } from 'nativewind';
import { Platform } from 'react-native';

export type AppearanceMode = 'system' | 'light' | 'dark';

const KEY = 'kobox.appearance';

export async function loadAppearance(): Promise<AppearanceMode> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Unreadable storage costs the preference, never the launch.
  }
  return 'system';
}

export function applyAppearance(mode: AppearanceMode) {
  // Expo pre-renders the web build in Node, where NativeWind refuses to set a
  // scheme and THROWS — and because this runs at module scope in the root
  // layout, that once took the whole dev server down, phones included.
  if (Platform.OS === 'web' && typeof window === 'undefined') return;

  try {
    colorScheme.set(mode);
  } catch {
    // Following the phone is the fallback, and never worth a crash.
  }
}

export async function saveAppearance(mode: AppearanceMode) {
  applyAppearance(mode);
  try {
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // Applied for this session regardless; only the next launch forgets.
  }
}
