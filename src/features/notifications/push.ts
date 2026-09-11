import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * Registering this device for push.
 *
 * Called on every launch rather than once: a token can be reissued by the OS
 * after a restore or an update, and a stale one means a member silently stops
 * hearing anything. Re-registering is cheap and idempotent.
 */

/** Foreground behaviour. Without this a push arriving while the app is open is swallowed. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPushToken(): Promise<string | null> {
  // A simulator has no push service, and asking produces a confusing failure
  // rather than a token.
  if (!Device.isDevice) return null;

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    if (status !== 'granted') {
      // Only ask once per install — repeatedly prompting is how people learn
      // to tap Deny.
      if (!existing.canAskAgain) return null;
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }

    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      // Android needs a channel or notifications land silently in a default one.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Kobox',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    // The EAS project id is required for a token that Expo's push service will
    // actually route; without it the call returns a token that goes nowhere.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;

    // The token is the natural key: the same device reinstalled gets a new one,
    // and a shared phone can move a token between accounts, so the row follows
    // whoever registered it last.
    await supabase.from('expo_push_tokens').upsert(
      {
        user_id: auth.user.id,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' }
    );

    return token;
  } catch {
    // Push is a convenience. Nothing here is worth blocking a launch over.
    return null;
  }
}

/** Drops this device's token, so a signed-out phone stops buzzing. */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await supabase.from('expo_push_tokens').delete().eq('token', token);
  } catch {
    // Nothing to do; the dispatcher drops dead tokens on its own.
  }
}
