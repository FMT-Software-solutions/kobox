/**
 * SMS credits and sender IDs.
 *
 * A GROUP IS THE ORGANIZATION. Everywhere below, the `organizationId` the
 * backend wants is this group's own id — there is no separate record, nothing
 * to provision and nothing for anyone to hand out. A group can only ever spend
 * credit it bought itself.
 */

import { APP_ID, APP_NAME, BACKEND, backendJson, paymentCallbackUrl } from '@/lib/backend';
import { supabase } from '@/lib/supabase';

/**
 * GHS per SMS credit.
 *
 * Display only. The backend derives what a payment actually bought from the
 * amount Paystack confirms was charged (`pricing.ts`) and ignores anything the
 * client says — the credit count used to travel in the callback URL, and
 * editing it bought arbitrary credits for GHS 20. Keep this in step with
 * `SMS_CREDIT_RATE_GHS`; it decides what the buttons say, never what is granted.
 */
export const CREDIT_RATE_GHS = 0.048;

/** What one credit sends: 160 GSM-7 characters to one person. */
export const CHARS_PER_CREDIT = 160;

export const PURCHASE_AMOUNTS = [20, 50, 100, 200, 500, 1000] as const;

export function creditsFor(amountGhs: number): number {
  return Math.floor(amountGhs / CREDIT_RATE_GHS);
}

export interface SmsBalance {
  credits: number;
  /** Credits the platform absorbed when a send cost more than the balance held. */
  bonusReceived: number;
  /** Credits spent this calendar month, against the cap. */
  usedThisMonth: number;
  monthlyCap: number;
  enabled: boolean;
  /** NULL means messages go out as the platform default, `Kobox`. */
  senderId: string | null;
}

/** Midnight on the first of the current month, matching the SQL cap window. */
function startOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function fetchSmsBalance(groupId: string): Promise<SmsBalance> {
  const [balance, group, spend] = await Promise.all([
    supabase
      .from('organization_sms_balances')
      .select('credit_balance, bonus_credits_received')
      .eq('organization_id', groupId)
      .maybeSingle(),
    supabase
      .from('groups')
      .select('sms_enabled, sms_monthly_cap, sms_sender_id')
      .eq('id', groupId)
      .single(),
    // Summed from the ledger rather than through `group_sms_used_this_month`.
    // That RPC is SECURITY DEFINER and takes a group id without checking
    // membership, so exposing it to the app let anyone ask what any group had
    // spent. Here RLS answers the question properly: treasurer and up, in this
    // group only. Usage is negative and bonus positive; both are credits spent.
    supabase
      .from('sms_credit_transactions')
      .select('amount, type')
      .eq('organization_id', groupId)
      .in('type', ['usage', 'bonus'])
      .gte('created_at', startOfMonth()),
  ]);

  if (group.error) throw group.error;
  if (balance.error) throw balance.error;
  if (spend.error) throw spend.error;

  const usedThisMonth = (spend.data ?? []).reduce((total, row) => total + Math.abs(row.amount), 0);

  return {
    credits: Number(balance.data?.credit_balance ?? 0),
    bonusReceived: Number(balance.data?.bonus_credits_received ?? 0),
    usedThisMonth,
    monthlyCap: Number(group.data.sms_monthly_cap ?? 0),
    enabled: group.data.sms_enabled,
    senderId: group.data.sms_sender_id,
  };
}

export async function setSmsEnabled(input: { groupId: string; enabled: boolean }) {
  const { error } = await supabase
    .from('groups')
    .update({ sms_enabled: input.enabled })
    .eq('id', input.groupId);

  if (error) throw error;
}

export async function setMonthlyCap(input: { groupId: string; cap: number }) {
  const { error } = await supabase
    .from('groups')
    .update({ sms_monthly_cap: input.cap })
    .eq('id', input.groupId);

  if (error) throw error;
}

/* ------------------------------------------------------------------ ledger -- */

export interface SmsTransaction {
  id: string;
  type: 'purchase' | 'usage' | 'bonus';
  /** Signed: positive for purchase and bonus, negative for usage. */
  amount: number;
  description: string;
  createdAt: string;
}

export async function fetchSmsTransactions(groupId: string): Promise<SmsTransaction[]> {
  const { data, error } = await supabase
    .from('sms_credit_transactions')
    .select('id, type, amount, description, created_at')
    .eq('organization_id', groupId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type as SmsTransaction['type'],
    amount: row.amount,
    description: row.description,
    createdAt: row.created_at,
  }));
}

/* ---------------------------------------------------------------- purchase -- */

export interface PurchaseHandle {
  authorizationUrl: string;
  reference: string;
}

export async function initializePurchase(input: {
  groupId: string;
  groupName: string;
  userId: string;
  email: string;
  amountGhs: number;
}): Promise<PurchaseHandle> {
  return backendJson<PurchaseHandle>(BACKEND.initializeSmsPurchase(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amountGhs: input.amountGhs,
      email: input.email,
      callbackUrl: paymentCallbackUrl(),
      organizationId: input.groupId,
      organizationName: input.groupName,
      userId: input.userId,
      appId: APP_ID,
      appName: APP_NAME,
    }),
  });
}

export type PurchaseStatus = 'pending' | 'success' | 'failed' | 'unknown';

export async function fetchPurchaseStatus(reference: string): Promise<PurchaseStatus> {
  const body = await backendJson<{ status: PurchaseStatus }>(BACKEND.purchaseStatus(reference));
  return body.status;
}

/* --------------------------------------------------------------- sender id -- */

export interface SenderIdRequest {
  id: string;
  senderId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  createdAt: string;
}

export async function fetchSenderIdRequests(groupId: string): Promise<SenderIdRequest[]> {
  const { data, error } = await supabase
    .from('sender_id_requests')
    .select('id, sender_id, reason, status, rejection_reason, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    senderId: row.sender_id,
    reason: row.reason,
    status: row.status as SenderIdRequest['status'],
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  }));
}

/**
 * Asks for a sender ID, then tells FMT there is one waiting.
 *
 * The row is the request; the email is only a nudge. Approval is a human act
 * performed against the database — the app has no way to approve its own
 * request, and RLS enforces that: a group admin who could set `status` could
 * send messages signed as anybody.
 */
export async function requestSenderId(input: {
  groupId: string;
  groupName: string;
  senderId: string;
  reason: string;
}) {
  const { error } = await supabase.from('sender_id_requests').insert({
    group_id: input.groupId,
    sender_id: input.senderId,
    reason: input.reason,
    status: 'pending',
  });

  if (error) {
    if (error.message.includes('at most 3')) {
      throw new Error('A group may hold at most 3 sender IDs. Withdraw one first.');
    }
    if (error.code === '23505') {
      throw new Error('That sender ID has already been requested for this group.');
    }
    throw error;
  }

  // Best effort. The request is already recorded; a failed email costs a
  // reminder, not the request, and failing the whole action for it would be
  // the worse outcome.
  try {
    await fetch(BACKEND.notifySenderId(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: input.groupName,
        senderId: input.senderId,
        reason: input.reason,
        action: 'created',
        appId: APP_ID,
        appName: APP_NAME,
      }),
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}

export async function withdrawSenderIdRequest(id: string) {
  const { error } = await supabase.from('sender_id_requests').delete().eq('id', id);
  if (error) throw error;
}
