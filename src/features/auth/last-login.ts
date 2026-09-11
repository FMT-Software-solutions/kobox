import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { buildSignInHint, type LastSignIn, type SignInMethod } from '@/lib/identity';

const KEY = 'kobox.last-sign-in';

/**
 * Remembers HOW someone last got in, so the launch screen can point at it.
 *
 * This is a convenience hint and nothing more — it is never read as part of
 * authentication, and only a masked identifier is stored, so a stolen device
 * gives up no more than "this person signs in with an 024 number ending 4567".
 *
 * It deliberately survives sign-out: being signed out is exactly when someone
 * needs reminding which door they came through. "Not you?" clears it.
 */
export async function rememberSignIn(method: SignInMethod, identifier: string): Promise<void> {
  const record: LastSignIn = { method, hint: buildSignInHint(method, identifier) };

  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // A hint is not worth failing a successful sign-in over.
  }
}

export async function readLastSignIn(): Promise<LastSignIn | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<LastSignIn>;
    if (parsed.method !== 'phone' && parsed.method !== 'email') return null;
    if (typeof parsed.hint !== 'string') return null;

    return { method: parsed.method, hint: parsed.hint };
  } catch {
    // Corrupt or unreadable — show the neutral screen rather than crash on it.
    return null;
  }
}

/** Backs the "Not you?" action on the launch screen. */
export async function forgetLastSignIn(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do; the hint is cosmetic.
  }
}

const lastSignInKey = ['auth', 'last-sign-in'] as const;

/**
 * A query rather than an effect: reading it is async, and React Compiler
 * rejects seeding state from an effect. `null` while loading is correct — the
 * launch screen shows both doors equally until it knows better.
 */
export function useLastSignIn() {
  return useQuery({ queryKey: lastSignInKey, queryFn: readLastSignIn, staleTime: Infinity });
}

export function useForgetLastSignIn() {
  const queryClient = useQueryClient();

  return async () => {
    await forgetLastSignIn();
    await queryClient.invalidateQueries({ queryKey: lastSignInKey });
  };
}
