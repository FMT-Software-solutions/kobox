// Supabase Send SMS Hook → Arkesel, via fmt-ss-backend.
//
// Supabase Auth still owns the whole OTP lifecycle — generating the code,
// hashing it, expiring it, rate limiting per phone and per IP, and verifying it
// on the way back. This function is ONLY the transport. That is the entire
// reason for using the hook rather than rolling our own phone auth: we never
// generate a code, never store one, and never mint a JWT.
//
// SMS goes through fmt-ss-backend's /sms/send, which is where every FMT app
// sends from. Kobox writes no Arkesel code.
//
// organizationId / appId are DELIBERATELY OMITTED. The backend runs its credit
// pre-flight only when both are present, and this is a *login* OTP: at this
// moment we do not know which group — if any — the caller belongs to, so no
// group's SMS credits can or should be charged. Group notifications later
// should pass them and handle 402.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const SENDER_ID = 'Kobox'; // Arkesel sender IDs are capped at 11 characters.
const OTP_TTL_MINUTES = 10;

/**
 * Supabase kills this hook at 5 seconds and reports
 * `Failed to reach hook within maximum time of 5.000000 seconds` — a message
 * the person signing in never sees. They just never get a code. A bare
 * `await fetch` has no timeout of its own, so we set one inside that budget.
 *
 * 4.2s, not 3.5s. The earlier value was picked from a measurement of a
 * *rejected* request (0.7–1.4s), which never reaches Arkesel. A real send does,
 * and routinely takes longer — so 3.5s aborted requests that had already been
 * dispatched. See the note on the timeout branch below: that is why a timeout
 * is no longer reported as a failure.
 */
const BACKEND_TIMEOUT_MS = 4200;

interface HookPayload {
  /**
   * `new_phone` is set when the user is CHANGING or ADDING a number rather than
   * signing in with one. For an account created with an email, `phone` is empty
   * and `new_phone` is the only place the destination appears — so reading
   * `phone` alone silently addressed the message to nobody.
   */
  user: { id: string; phone?: string; new_phone?: string };
  sms: { otp: string };
}

/**
 * Normalises BACKEND_URL to the API root.
 *
 * fmt-ss-backend mounts every route under an unconditional global prefix
 * (`app.setGlobalPrefix('api')`), so the canonical value is
 * `https://api.fmtsoftware.com/api`. A bare origin is corrected rather than
 * left to 404 — there is no deployment where /sms/send lives at the root, so
 * this cannot mask a real route.
 */
function smsEndpoint(backendUrl: string): string {
  const trimmed = backendUrl.replace(/\/+$/, '');
  return `${/\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`}/sms/send`;
}

/**
 * Arkesel wants a bare international number: `233241234567`.
 *
 * Supabase stores phones without the leading plus already, but a stray `+` or
 * local `0` would be silently undeliverable rather than an error, so both are
 * handled here.
 */
function toArkeselRecipient(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

/**
 * Plain ASCII, one GSM-7 segment, and no curly braces.
 *
 * `{` and `}` would make the backend treat this as a template and route it to
 * Arkesel's template API, which then rejects it for an unknown variable — so a
 * brace here would break every login rather than one message.
 */
function buildMessage(otp: string): string {
  return `${otp} is your Kobox code. It expires in ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { http_code: 405, message: 'POST only' } }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hookSecret = Deno.env.get('SEND_SMS_HOOK_SECRET');
  const backendUrl = Deno.env.get('BACKEND_URL');

  // Misconfiguration must be loud. A hook that quietly returns 200 without
  // sending anything looks exactly like "the SMS never arrived", which is the
  // most expensive way for this to break.
  if (!hookSecret) {
    console.error('[send-sms-hook] SEND_SMS_HOOK_SECRET is not set');
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: 'Hook secret not configured' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (!backendUrl) {
    console.error('[send-sms-hook] BACKEND_URL is not set');
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: 'Backend URL not configured' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let payload: HookPayload;
  try {
    const body = await req.text();
    const headers = Object.fromEntries(req.headers);
    // Standard Webhooks. Without this anyone who found the URL could make us
    // send SMS on the project's credit, to any number they liked.
    const wh = new Webhook(hookSecret.replace('v1,whsec_', ''));
    payload = wh.verify(body, headers) as HookPayload;
  } catch (err) {
    console.error('[send-sms-hook] signature verification failed', err);
    return new Response(
      JSON.stringify({ error: { http_code: 401, message: 'Invalid webhook signature' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // `new_phone` FIRST. When someone adds or changes a number, that is the one
  // being verified and the one the code has to reach; `phone` still holds the
  // old value, and is empty for an account created with an email. Reading
  // `phone` alone made every "add your phone number" attempt fail here with a
  // 400, which Supabase then surfaced to the user as a bare 500 on
  // /auth/v1/user — no SMS, no explanation.
  const phone = toArkeselRecipient(payload.user?.new_phone || payload.user?.phone || '');
  const otp = payload.sms?.otp ?? '';

  if (!phone || !otp) {
    console.error(
      `[send-sms-hook] payload missing phone or otp (phone=${phone ? 'set' : 'empty'}, otp=${
        otp ? 'set' : 'empty'
      })`
    );
    return new Response(
      JSON.stringify({ error: { http_code: 400, message: 'Payload missing phone or otp' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const resp = await fetch(smsEndpoint(backendUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: SENDER_ID,
        message: buildMessage(otp),
        recipients: [{ phone }],
        sandbox: false,
        // organizationId / appId omitted on purpose — see the note at the top.
      }),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      // Never log the OTP or the full number; this ends up in project logs.
      console.error(`[send-sms-hook] backend ${resp.status}: ${detail.slice(0, 300)}`);
      return new Response(
        JSON.stringify({
          error: { http_code: 500, message: `SMS provider rejected the message (${resp.status})` },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[send-sms-hook] code sent to ...${phone.slice(-4)}`);
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // A timeout and an unreachable host need different fixes — the first is a
    // slow backend, the second a wrong URL or a dead one — so they must not
    // land in the logs as the same line.
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';

    if (timedOut) {
      /*
       * A timeout is NOT reported as a failure, and this is the important part.
       *
       * By the time it fires, the request has already been accepted by the
       * backend and the SMS is on its way to Arkesel — we simply gave up
       * waiting for the acknowledgement. Returning 500 here produced the worst
       * possible outcome: the code arrived on the person's phone while the app
       * showed them a red error and refused to advance to the code screen, so a
       * perfectly good OTP was unusable.
       *
       * Returning 200 lets them type the code that is already in their hand. If
       * the send genuinely did fail, they wait, see no SMS, and ask for another
       * — which is the same recovery they have for a dropped message anyway.
       * The failures worth reporting are the fast ones (a 4xx, out of credits),
       * and those still come back in time to be handled above.
       */
      console.error(
        `[send-sms-hook] backend did not acknowledge within ${BACKEND_TIMEOUT_MS}ms — ` +
          'assuming sent, returning 200 so the code stays usable'
      );
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.error('[send-sms-hook] backend unreachable', err);

    // Only genuinely unreachable now — the timeout branch returned above.
    return new Response(
      JSON.stringify({
        error: { http_code: 500, message: 'Could not reach the SMS service' },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
