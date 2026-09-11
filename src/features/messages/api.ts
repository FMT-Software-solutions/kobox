/**
 * Group messages — an admin writing to everyone, a tag, or chosen members.
 *
 * Nothing here calls the SMS backend. A message is handed to
 * `send_group_message`, which checks the admin role, resolves the audience,
 * refuses what the group cannot afford, and writes one outbox row per
 * recipient. The dispatcher does the sending, exactly as it does for receipts,
 * so preferences, credits, the monthly limit and delivery receipts all apply
 * without a second copy of any of them.
 */

import { supabase } from '@/lib/supabase';

export type Audience =
  { kind: 'everyone' } | { kind: 'tag'; tagId: string } | { kind: 'members'; memberIds: string[] };

/** What the composer shows before anybody presses send. */
export interface MessagePreview {
  recipients: number;
  bySms: number;
  byPush: number;
  /** Neither a phone that accepts texts nor a device that accepts push. */
  unreachable: number;
  /** Total credits to text everyone who would be texted. */
  credits: number;
  balance: number;
  capLeft: number;
  smsEnabled: boolean;
  /** False means the send will be refused unless it goes by push only. */
  affordable: boolean;
}

export interface SentMessage extends MessagePreview {
  messageId: string;
  pushOnly: boolean;
}

function audienceArgs(audience: Audience) {
  switch (audience.kind) {
    case 'everyone':
      return { p_audience: 'everyone' };
    case 'tag':
      return { p_audience: 'tag', p_tag_id: audience.tagId };
    case 'members':
      return { p_audience: 'members', p_member_ids: audience.memberIds };
  }
}

export async function previewMessage(input: {
  groupId: string;
  body: string;
  audience: Audience;
}): Promise<MessagePreview> {
  const { data, error } = await supabase.rpc('preview_group_message', {
    p_group_id: input.groupId,
    p_body: input.body,
    ...audienceArgs(input.audience),
  });

  if (error) throw error;
  return data as unknown as MessagePreview;
}

export async function sendMessage(input: {
  groupId: string;
  body: string;
  audience: Audience;
  pushOnly?: boolean;
}): Promise<SentMessage> {
  const { data, error } = await supabase.rpc('send_group_message', {
    p_group_id: input.groupId,
    p_body: input.body,
    ...audienceArgs(input.audience),
    // Omitted rather than sent as false: an optional RPC argument must be left
    // out for its DEFAULT to apply (HANDOFF gotcha).
    ...(input.pushOnly ? { p_push_only: true } : {}),
  });

  if (error) throw error;
  return data as unknown as SentMessage;
}

export interface MessageHistoryRow {
  id: string;
  body: string;
  audience: 'everyone' | 'tag' | 'members';
  tagName: string | null;
  sentBy: string | null;
  createdAt: string;
  pushOnly: boolean;
  recipients: number;
  texted: number;
  delivered: number;
  /** Meant to be texted and was not: out of credit mid-run, a bad number, a refusal. */
  notTexted: number;
  pushed: number;
  /** Still in the outbox, usually for under a minute. */
  waiting: number;
}

export async function fetchMessageHistory(groupId: string): Promise<MessageHistoryRow[]> {
  const { data, error } = await supabase.rpc('group_message_history', { p_group_id: groupId });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    audience: row.audience as MessageHistoryRow['audience'],
    tagName: row.tag_name,
    sentBy: row.sent_by,
    createdAt: row.created_at,
    pushOnly: row.push_only,
    recipients: row.recipients,
    texted: row.texted,
    delivered: row.delivered,
    notTexted: row.not_texted,
    pushed: row.pushed,
    waiting: row.waiting,
  }));
}
