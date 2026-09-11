-- Closing every privileged function that was only half-revoked.
--
-- **`revoke ... from anon, authenticated` does almost nothing.** Postgres grants
-- `EXECUTE` on a new function to **PUBLIC** — a grant that `anon` and
-- `authenticated` inherit without either role being named anywhere. Revoking
-- from the two roles leaves the PUBLIC grant untouched and the function wide
-- open, while the migration reads as though it has been locked down. That is
-- the worst shape a security bug can take: it looks handled.
--
-- Caught by a ledger check written the same day, which called
-- `add_sms_credits` with an anon key and expected to be refused. It was not.
-- Any signed-in person could have minted unlimited SMS credits for any group,
-- or spent another group's balance to zero.
--
-- Every `revoke` below therefore names **public**, and the roles that genuinely
-- need each function are granted back explicitly. The rule for the future is
-- one line: on a SECURITY DEFINER function, revoke from `public`, then grant.
--
-- pg_cron runs its jobs as the database superuser, which is not subject to
-- these grants, so the scheduled queue functions keep working with no grant at
-- all. Only the backend, arriving through PostgREST as `service_role`, needs
-- one — and only for the two credit RPCs and the delivery webhook.

-- ---------------------------------------------------------------------------
-- SMS credits — money. The most important of these.
-- ---------------------------------------------------------------------------

revoke execute on function add_sms_credits(uuid, integer, text, jsonb) from public;
revoke execute on function deduct_sms_credits(uuid, integer, text, jsonb) from public;
revoke execute on function record_sms_delivery(text, text, text) from public;

-- fmt-ss-backend, and nothing else. It calls these with the service_role key
-- after Paystack has confirmed a payment and after Arkesel has accepted a send.
grant execute on function add_sms_credits(uuid, integer, text, jsonb) to service_role;
grant execute on function deduct_sms_credits(uuid, integer, text, jsonb) to service_role;
grant execute on function record_sms_delivery(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The notification outbox
--
-- `enqueue_notification` is SECURITY DEFINER and takes the message body as an
-- argument. Left callable, it lets anybody put words into a text message that
-- arrives signed as the group — which is worse than the spend it also causes.
-- ---------------------------------------------------------------------------

revoke execute on function enqueue_notification(
  uuid, uuid, text, text, text, text, text, timestamptz
) from public;

revoke execute on function enqueue_for_role(uuid, member_role, text, text, text, text)
  from public;

-- ---------------------------------------------------------------------------
-- The clock
--
-- These are the cron jobs' own entry points. Nobody else has any business
-- calling them: `queue_overdue_reminders` run in a loop is a way to text every
-- member of every group repeatedly at somebody else's expense, and
-- `dispatch_notifications` fires an outbound HTTP request per call.
-- ---------------------------------------------------------------------------

revoke execute on function queue_period_reminders()        from public;
revoke execute on function queue_overdue_reminders()       from public;
revoke execute on function queue_invite_expiry_warnings()  from public;
revoke execute on function dispatch_notifications()        from public;

-- `next_sendable_at` only computes a timestamp and leaks nothing, but it is
-- SECURITY DEFINER and reads `groups`, so it goes the same way. Nothing in the
-- app calls it; quiet hours are applied where a notification is queued.
revoke execute on function next_sendable_at(uuid, timestamptz) from public;

-- ---------------------------------------------------------------------------
-- The budget helpers
--
-- These were granted to `authenticated` deliberately, so the app could show a
-- group its own spend. The grant was wrong all the same: both take a group id
-- and neither checks membership, so any signed-in person could ask how much any
-- group had spent this month and whether it could still text. Small, but it is
-- somebody else's business.
--
-- They stay as INTERNAL helpers — `enqueue_notification` calls
-- `group_can_send_sms` on every queued row, and does so under cron, where there
-- is no `auth.uid()` to check membership against. The app reads its own spend
-- from `sms_credit_transactions` instead, where RLS already answers the
-- question properly: treasurer and up, in that group only.
-- ---------------------------------------------------------------------------

revoke execute on function group_sms_used_this_month(uuid) from public;
revoke execute on function group_can_send_sms(uuid)        from public;
