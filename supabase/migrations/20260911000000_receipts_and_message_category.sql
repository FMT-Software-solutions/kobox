-- Receipts, as they were always described — and room for group messages.
--
-- HANDOFF said receipts "cannot be switched off", and the Reminders screen said
-- the same thing to members. The code never did it: `enqueue_notification`
-- applied a member's push and SMS switches to every category alike, so somebody
-- with both off got no receipt at all.
--
-- The rule is now split by channel, because the two channels cost different
-- things:
--
--   * PUSH receipts always go. Push is free, and a receipt is a record of
--     somebody's money — being able to say "I was never told" is exactly what
--     it exists to prevent.
--   * SMS receipts respect the member's choice. A text costs the group real
--     money, and forcing one on somebody who said "no texts" spends the
--     group's credit against their stated wishes.
--
-- Receipts are the three categories that record money moving to or for a
-- member: a payment recorded, a payment reversed, and a susu payout.
--
-- The new `message` category is for group messages an admin writes by hand
-- (`20260911020000`). It respects BOTH switches — it is not a record of
-- anybody's money — and it is not a reminder, so the reminders switch does not
-- silence it.

alter table notifications drop constraint if exists notifications_category_check;

alter table notifications add constraint notifications_category_check check (category in (
  'join_request', 'join_decision', 'payment_recorded', 'payment_reversed',
  'payment_pending', 'expense_pending', 'period_opened', 'overdue',
  'susu_payout', 'invite_expiring', 'digest', 'message'
));

-- Same argument list as before, so this REPLACES rather than adding an
-- overload (HANDOFF gotcha 1). Privileges survive a replace, and are restated
-- at the bottom regardless.
create or replace function enqueue_notification(
  p_group_id   uuid,
  p_member_id  uuid,
  p_category   text,
  p_title      text,
  p_body       text,
  p_sms_body   text default null,
  p_dedupe_key text default null,
  p_send_after timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member group_members;
  v_prefs  notification_preferences;
  v_key    text;
  v_push   boolean;
  v_sms    boolean;
begin
  select * into v_member from group_members where id = p_member_id;
  if v_member.id is null or v_member.status = 'left' then
    return;
  end if;

  select * into v_prefs from notification_preferences where member_id = p_member_id;

  -- Absent preferences mean the defaults, not "off".
  v_push := coalesce(v_prefs.push_enabled, true);
  v_sms  := coalesce(v_prefs.sms_enabled, true);

  -- A receipt is a record of money, so its push always goes. Its SMS still
  -- respects the member's choice — see the header.
  if p_category in ('payment_recorded', 'payment_reversed', 'susu_payout') then
    v_push := true;
  end if;

  -- Reminders are the one category somebody may silence outright.
  if p_category in ('period_opened', 'overdue')
     and not coalesce(v_prefs.reminders_enabled, true) then
    return;
  end if;

  -- An SMS is only worth queueing for the categories that justify the cost, and
  -- only when the group can actually pay for it. `group_can_send_sms` is
  -- checked again at dispatch, because a month's budget can run out between
  -- queueing and sending.
  v_sms := v_sms
    and v_member.phone_e164 is not null
    and p_category in (
      'payment_recorded', 'payment_reversed', 'period_opened', 'overdue',
      'susu_payout', 'message'
    )
    and group_can_send_sms(p_group_id);

  if not v_push and not v_sms then
    return;
  end if;

  -- Default key covers the common case: one notification per member per event.
  v_key := coalesce(p_dedupe_key, p_category || ':' || p_member_id::text || ':' || now()::text);

  insert into notifications (
    group_id, member_id, user_id, phone_e164,
    category, title, body, sms_body,
    want_push, want_sms, dedupe_key, send_after
  )
  values (
    p_group_id, p_member_id, v_member.user_id, v_member.phone_e164,
    p_category, p_title, p_body, coalesce(p_sms_body, p_body),
    v_push and v_member.user_id is not null, v_sms,
    v_key, p_send_after
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

-- Restated, naming every grantee (HANDOFF: two revokes, and neither alone works).
revoke execute on function enqueue_notification(
  uuid, uuid, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
