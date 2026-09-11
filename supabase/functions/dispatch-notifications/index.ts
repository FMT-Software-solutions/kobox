// Drains the notification outbox: Expo push for anyone with the app, SMS
// through fmt-ss-backend for the categories that justify the cost.
//
// Called once a minute by pg_cron via pg_net (see `dispatch_notifications()`),
// authenticated by a shared secret rather than a JWT — there is no user here,
// only a clock.
//
// The order of operations matters and is deliberate: mark the batch as claimed
// BEFORE sending. A crash mid-send then leaves rows marked sent-but-unsent,
// which loses a message; the alternative leaves them pending and sends the
// batch twice, which costs money and trust. Losing a reminder is recoverable
// next cycle. Charging somebody twice for the same text is not.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo accepts at most 100 messages per request. */
const PUSH_CHUNK = 100;

/** How many rows one run drains. Keeps a minute's work inside a minute. */
const BATCH = 200;

/**
 * Sender ID used when a group has not had its own approved.
 *
 * Arkesel sender IDs are capped at 11 characters and registered with the
 * networks by hand, so this one is the default rather than a fallback: almost
 * every group will send as `Kobox` for ever, and a group with no sender ID of
 * its own can still text from the moment it has credit.
 */
const DEFAULT_SENDER_ID = 'Kobox';

/** How this function identifies itself to fmt-ss-backend's app registry. */
const APP_ID = 'kobox';

const BACKEND_TIMEOUT_MS = 8000;

interface NotificationRow {
  id: string;
  group_id: string;
  user_id: string | null;
  phone_e164: string | null;
  title: string;
  body: string;
  sms_body: string | null;
  want_push: boolean;
  want_sms: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Typographic Unicode → its GSM-7 twin.
 *
 * This is a COST control, not a cosmetic one. An SMS is billed per segment:
 * 160 characters in GSM-7, but only 70 in UCS-2, and a single character outside
 * GSM-7 forces the whole message into UCS-2. So one curly apostrophe in a group
 * name — which a phone keyboard inserts without being asked — silently turns a
 * one-credit receipt into a three-credit one, for every member, every month.
 *
 * fmt-ss-backend normalises again on the way out (`normalizeGsm7`). Doing it
 * here as well is not redundant: it is what makes this function's own idea of
 * what a message costs match what the group is actually charged.
 */
const GSM7_GROUPS: Array<[string, number[]]> = [
  ['-', [0x2013, 0x2014, 0x2015, 0x2011, 0x2212, 0x2022, 0x00b7, 0x2027]],
  ["'", [0x2018, 0x2019, 0x201a, 0x201b, 0x2032]],
  ['"', [0x201c, 0x201d, 0x201e, 0x2033]],
  ['...', [0x2026]],
  ['x', [0x00d7]],
  [
    ' ',
    [
      0x00a0, 0x202f, 0x2007, 0x2009, 0x200a, 0x2002, 0x2003, 0x2004, 0x2005,
      0x2006, 0x2008, 0x205f, 0x3000,
    ],
  ],
  ['', [0x200b, 0xfeff, 0x200c, 0x200d]],
];

const GSM7 = new Map<string, string>();
for (const [replacement, codePoints] of GSM7_GROUPS) {
  for (const cp of codePoints) GSM7.set(String.fromCodePoint(cp), replacement);
}

/**
 * Makes a message safe and cheap to send.
 *
 * The braces matter separately: the backend reads `{` and `}` as template
 * placeholders and routes to Arkesel's template API, which then rejects the
 * message for an unknown variable. Group names are user-supplied, so this is
 * not hypothetical.
 */
function safeSms(text: string): string {
  let out = '';
  for (const ch of text) out += GSM7.get(ch) ?? ch;
  return out.replace(/[{}]/g, '');
}

function smsEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? `${trimmed}/sms/send` : `${trimmed}/api/sms/send`;
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('DISPATCH_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const backendUrl = Deno.env.get('BACKEND_URL');

  if (!secret || !supabaseUrl || !serviceKey) {
    console.error('[dispatch] missing DISPATCH_SECRET, SUPABASE_URL or SERVICE_ROLE_KEY');
    return new Response('misconfigured', { status: 500 });
  }

  if (req.headers.get('x-dispatch-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: due, error } = await supabase
    .from('notifications')
    .select(
      'id, group_id, user_id, phone_e164, title, body, sms_body, want_push, want_sms'
    )
    .eq('status', 'pending')
    .lte('send_after', new Date().toISOString())
    .order('created_at')
    .limit(BATCH);

  if (error) {
    console.error('[dispatch] could not read the outbox', error.message);
    return new Response('read failed', { status: 500 });
  }

  const rows = (due ?? []) as NotificationRow[];
  if (rows.length === 0) {
    return Response.json({ claimed: 0 });
  }

  // Claim first. See the note at the top.
  const ids = rows.map((row) => row.id);
  const { error: claimError } = await supabase
    .from('notifications')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .in('id', ids);

  if (claimError) {
    console.error('[dispatch] could not claim the batch', claimError.message);
    return new Response('claim failed', { status: 500 });
  }

  let pushed = 0;
  let texted = 0;

  /* ---------------------------------------------------------------- push -- */

  const pushWanted = rows.filter((row) => row.want_push && row.user_id);

  if (pushWanted.length > 0) {
    const userIds = [...new Set(pushWanted.map((row) => row.user_id!))];
    const { data: tokens } = await supabase
      .from('expo_push_tokens')
      .select('user_id, token')
      .in('user_id', userIds);

    // One person may hold several devices, and all of them should buzz.
    const byUser = new Map<string, string[]>();
    for (const entry of tokens ?? []) {
      const list = byUser.get(entry.user_id) ?? [];
      list.push(entry.token);
      byUser.set(entry.user_id, list);
    }

    const messages = pushWanted.flatMap((row) =>
      (byUser.get(row.user_id!) ?? []).map((token) => ({
        to: token,
        title: row.title,
        body: row.body,
        sound: 'default',
        data: { notificationId: row.id, groupId: row.group_id },
      }))
    );

    // Notification ids Expo accepted at least one push for.
    const delivered = new Set<string>();

    for (const batch of chunk(messages, PUSH_CHUNK)) {
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          console.error(`[dispatch] expo push ${response.status}`);
          continue;
        }

        const result = await response.json();
        const tickets = result?.data ?? [];

        // A DeviceNotRegistered ticket means the app was uninstalled. Dropping
        // the token here is the only way the table does not grow for ever.
        const dead: string[] = [];
        tickets.forEach(
          (ticket: { status?: string; details?: { error?: string } }, index: number) => {
            const message = batch[index];
            if (!message) return;

            if (ticket?.status === 'ok') {
              delivered.add(message.data.notificationId);
            } else if (ticket?.details?.error === 'DeviceNotRegistered') {
              dead.push(message.to);
            }
          }
        );

        if (dead.length > 0) {
          await supabase.from('expo_push_tokens').delete().in('token', dead);
        }

        pushed += batch.length - dead.length;
      } catch (err) {
        console.error('[dispatch] expo push failed', err);
      }
    }

    // Only the rows Expo actually accepted. This used to stamp EVERY row in the
    // batch the moment any single push succeeded — including rows for members
    // with no device at all — so "pushed" in the message history counted people
    // who had never installed the app.
    if (delivered.size > 0) {
      await supabase
        .from('notifications')
        .update({ push_sent: true })
        .in('id', [...delivered]);
    }
  }

  /* ----------------------------------------------------------------- sms -- */

  const smsWanted = rows.filter((row) => row.want_sms && row.phone_e164);

  if (smsWanted.length > 0 && backendUrl) {
    // Group by group: each one bills its own organization, and the budget is
    // re-checked here because a month's cap can be reached between queueing
    // and sending.
    const byGroup = new Map<string, NotificationRow[]>();
    for (const row of smsWanted) {
      const list = byGroup.get(row.group_id) ?? [];
      list.push(row);
      byGroup.set(row.group_id, list);
    }

    for (const [groupId, entries] of byGroup) {
      // A GROUP IS THE ORGANIZATION. `organizationId` below is this id — there
      // is no separate record to look up and nothing to map.
      const [{ data: group }, { data: balance }] = await Promise.all([
        supabase
          .from('groups')
          .select('sms_enabled, sms_monthly_cap, sms_sender_id')
          .eq('id', groupId)
          .single(),
        supabase
          .from('organization_sms_balances')
          .select('credit_balance')
          .eq('organization_id', groupId)
          .maybeSingle(),
      ]);

      if (!group?.sms_enabled) continue;

      // Checked here as well as at enqueue time: a month's budget and a wallet
      // can both empty between the two, and the backend will happily overdraw a
      // group into `bonus` credits rather than refuse a multipart message.
      const credits = Number(balance?.credit_balance ?? 0);
      if (credits <= 0) {
        console.warn(`[dispatch] group ${groupId} has no SMS credits`);
        continue;
      }

      const { data: used } = await supabase.rpc('group_sms_used_this_month', {
        p_group_id: groupId,
      });

      const capLeft = (group.sms_monthly_cap ?? 0) - Number(used ?? 0);
      if (capLeft <= 0) {
        console.warn(`[dispatch] group ${groupId} has reached its SMS cap`);
        continue;
      }

      // Both limits are in CREDITS, and a long message costs more than one, so
      // this is an upper bound on messages rather than an exact budget. The
      // backend's own pre-flight is what actually refuses a send it cannot pay
      // for; this only avoids queueing work that is obviously past the line.
      const room = Math.min(capLeft, credits);
      const sender = (group.sms_sender_id || DEFAULT_SENDER_ID).slice(0, 11);

      // Oldest first, so a cap truncates the newest rather than the message
      // somebody has already been waiting on.
      const allowed = entries.slice(0, room);

      // The message differs per recipient, so one call each rather than the
      // multi-recipient form — that is for identical broadcasts.
      for (const row of allowed) {
        try {
          const response = await fetch(smsEndpoint(backendUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender,
              message: safeSms(row.sms_body ?? row.body),
              recipients: [{ phone: row.phone_e164!.replace(/\D/g, '') }],
              // The group pays for its own messages. Both fields are required
              // together — the backend runs its credit pre-flight only when it
              // has both, which is exactly why the OTP hook omits them.
              organizationId: groupId,
              appId: APP_ID,
              // Asks Arkesel for a delivery receipt against this outbox row, so
              // "sent" can later become "delivered" or "failed". Without it,
              // sent means only that the provider accepted it.
              messageRef: row.id,
              sandbox: false,
            }),
            signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
          });

          if (response.status === 402) {
            console.warn(`[dispatch] group ${groupId} is out of SMS credits`);
            break;
          }

          if (!response.ok) {
            console.error(`[dispatch] sms ${response.status} for ${row.id}`);
            continue;
          }

          await supabase.from('notifications').update({ sms_sent: true }).eq('id', row.id);
          texted += 1;
        } catch (err) {
          console.error(`[dispatch] sms failed for ${row.id}`, err);
        }
      }
    }
  }

  console.log(`[dispatch] claimed ${rows.length}, pushed ${pushed}, texted ${texted}`);
  return Response.json({ claimed: rows.length, pushed, texted });
});
