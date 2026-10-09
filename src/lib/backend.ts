/**
 * Talking to fmt-ss-backend.
 *
 * Kobox owns its own database; it does NOT own SMS. Arkesel credentials, the
 * Paystack secret and the credit pricing all live in the shared backend, and
 * every FMT product reaches them through the same endpoints. That is
 * deliberate: an SMS provider integration copied into five apps is five places
 * to fix when a provider changes, and this organisation has already made that
 * mistake once.
 *
 * The one identity Kobox has to assert is `APP_ID`. The backend resolves it to
 * this project's Supabase database, which is where the group's credit balance,
 * its ledger and its purchase records live.
 */

import { env } from '@/lib/env';

/** How Kobox identifies itself to the backend's app registry. */
export const APP_ID = 'kobox';

/** Display name, used in admin notification emails and the Paystack landing page. */
export const APP_NAME = 'Kobox';

/**
 * Where the browser version lives. It goes into invitations, so somebody
 * without the phone app has somewhere to use the join code.
 */
export const WEB_APP_URL = 'https://kobox.fmtsoftware.com';

/**
 * Every backend route sits under a global `/api` prefix (`app.setGlobalPrefix`
 * in its main.ts), so the canonical value already ends in `/api`. A bare origin
 * is corrected rather than left to 404 — there is no deployment where
 * `/sms/send` lives at the root, so this cannot mask a real route.
 */
function apiRoot(): string {
  const trimmed = env.backendUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export const BACKEND = {
  initializeSmsPurchase: () => `${apiRoot()}/payments/initialize-sms-purchase`,
  purchaseStatus: (reference: string) =>
    `${apiRoot()}/payments/purchase-status/${encodeURIComponent(reference)}?appId=${APP_ID}`,
  notifySenderId: () => `${apiRoot()}/sms/sender-id/notify`,
} as const;

/**
 * Where Paystack sends the browser once payment finishes.
 *
 * Crediting does not depend on this. The Paystack webhook credits the group
 * server-side whatever the browser does — this only decides where the person
 * lands, and the app polls the reference regardless.
 *
 * It is Kobox's own page, `/payment-complete` on the web app, for the phone app
 * and the browser alike. It used to be the page every FMT product shares on
 * fmtsoftware.com, from when Kobox had no website to land on; that page still
 * works for a Kobox reference and is the one to point back at if this site is
 * ever down. Paystack appends `reference` itself, which is all the page needs.
 *
 * A deep link back into the app would be neater and is wrong: Paystack requires
 * an https callback, and a custom scheme silently falls back to the Paystack
 * dashboard default, which is how Print Suite Pro once lost the reference
 * entirely.
 */
export function paymentCallbackUrl(): string {
  return `${WEB_APP_URL}/payment-complete`;
}

/** A backend error carries a `message`; a network failure does not. */
export async function backendJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error('Could not reach the Kobox server. Check your connection and try again.');
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(body?.message ?? `The server refused that request (${response.status}).`);
  }

  return body as T;
}
