/**
 * Deleting your own account.
 *
 * The same code serves the app's Settings and the public web page at
 * kobox.fmtsoftware.com/delete-account — Google Play requires both, and two
 * implementations of "delete my account" is one too many.
 *
 * What goes and what stays is decided server-side; see
 * `20260911050000_account_deletion.sql`.
 */

import { forgetLastSignIn } from '@/features/auth/last-login';
import { supabase } from '@/lib/supabase';

export interface GroupRef {
  id: string;
  name: string;
}

export interface DeletionPreview {
  /** Groups they alone own that others use. Deletion is refused until resolved. */
  blocking: GroupRef[];
  /** Groups nobody else can open. Deleted along with the account. */
  deleting: GroupRef[];
}

export async function fetchDeletionPreview(): Promise<DeletionPreview> {
  const { data, error } = await supabase.rpc('account_deletion_preview');
  if (error) throw error;
  return data as unknown as DeletionPreview;
}

export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });

  if (error) {
    // A non-2xx from the function arrives as a FunctionsHttpError whose body
    // carries the real reason — "you are the only owner of …" is worth more
    // than "Edge Function returned a non-2xx status code".
    let message = 'Your account could not be deleted. Please try again.';
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch {
      // Keep the generic sentence.
    }
    throw new Error(message);
  }

  // The server has already ended every session; this clears this device.
  await forgetLastSignIn();
  await supabase.auth.signOut({ scope: 'local' });
}
