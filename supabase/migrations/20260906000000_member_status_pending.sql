-- `pending` — asked to join, not yet approved.
--
-- Alone in its own migration on purpose. Postgres refuses to use a new enum
-- value in the same transaction that adds it ("unsafe use of new value of enum
-- type"), and Supabase runs each migration file as one transaction. Everything
-- that reads or writes 'pending' therefore lives in the next file.
--
-- Distinct from the existing `invited`, which means "an admin created this
-- record and the person has not signed up yet". `pending` is the opposite
-- direction of travel: the person turned up first and is waiting on the group.

alter type member_status add value if not exists 'pending';
