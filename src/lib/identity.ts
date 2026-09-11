/**
 * How the launch screen refers to whoever signed in last.
 *
 * Someone who has been signed out should not have to remember whether they used
 * their phone or their email — the app tells them. What it must NOT do is hand
 * a full phone number or email address to whoever picks the device up, so the
 * hint is always partly hidden.
 *
 * Masking lives here, away from the storage wrapper, because the storage
 * wrapper imports AsyncStorage — a native module that cannot load under
 * `node --test`. Keeping these pure keeps them tested.
 */

// Explicit .ts extension: this is a value import, so `node --test` has to
// resolve it for real (a bare `import type` is erased and never resolved).
import { maskGhanaPhone } from './phone.ts';

/** The two ways into Kobox. Role is per-group, so it is never a login choice. */
export type SignInMethod = 'phone' | 'email';

export interface LastSignIn {
  method: SignInMethod;
  /** Already masked. A full identifier is never persisted for this. */
  hint: string;
}

/**
 * `ama@example.com` → `a•••@example.com`.
 *
 * The domain stays because it is the part that jogs the memory — "oh, my Gmail
 * one" — while the local part is what identifies the person.
 */
export function maskEmail(email: string): string {
  const trimmed = (email ?? '').trim();
  const at = trimmed.lastIndexOf('@');

  // Not an address we understand; hide it entirely rather than leak it whole.
  if (at <= 0 || at === trimmed.length - 1) {
    return trimmed.length > 0 ? '•••' : '';
  }

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);

  return `${local[0]}•••${domain}`;
}

/** Builds the stored hint for a successful sign-in. */
export function buildSignInHint(method: SignInMethod, identifier: string): string {
  return method === 'phone' ? maskGhanaPhone(identifier) : maskEmail(identifier);
}
