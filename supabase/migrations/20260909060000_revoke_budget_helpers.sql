-- The other half of the grant lesson.
--
-- `20260909050000` revoked every privileged function from **public**, which is
-- what removes the implicit grant Postgres hands out on `create function`. Two
-- functions did not move: `group_sms_used_this_month` and `group_can_send_sms`
-- were **explicitly** granted to `authenticated` when they were written, and a
-- revoke from PUBLIC does not touch an explicit grant to a role.
--
-- So the pair of rules is:
--   * revoking from `anon, authenticated` misses the PUBLIC grant;
--   * revoking from `public` misses an explicit role grant.
-- Only naming every grantee actually closes a function, and the only way to
-- know which applies is to try calling it with an anon key. Both halves of this
-- were found that way, by the same ledger check, one run apart.

revoke execute on function group_sms_used_this_month(uuid) from public, anon, authenticated;
revoke execute on function group_can_send_sms(uuid)        from public, anon, authenticated;
