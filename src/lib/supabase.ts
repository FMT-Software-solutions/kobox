import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from './database.types';
import { env } from './env';

/**
 * NOTE: AsyncStorage is a native module. It throws at import time if it was not
 * compiled into the running binary, which shows up as "AsyncStorage is null" on
 * launch and cannot be caught by any runtime guard here. If you ever see that,
 * the development client is stale — rebuild it:
 *
 *   npx eas-cli@latest build --profile development --platform android
 *
 * The same applies to any dependency shipping a native `android/` or `ios/`
 * folder. Pure-JS packages never need a rebuild.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseKey, {
  auth: {
    // Sessions live in AsyncStorage so a member stays signed in between launches.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // There is no URL bar in a native app — session detection from the URL would
    // only ever misfire here.
    detectSessionInUrl: false,
  },
});

/**
 * Supabase refreshes tokens on a timer, which the OS suspends when the app is
 * backgrounded. Without this, a member who leaves Kobox for an hour comes back to
 * an expired session and a screen full of failed requests.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
