-- Scheduling and outbound HTTP, for the notification dispatcher.
--
-- Alone in its own migration so the dependency fails loudly and early. Every
-- scheduled reminder rests on pg_cron being available on this project; finding
-- that out halfway through wiring the triggers would be the expensive way.
--
-- `with schema extensions` keeps them out of `public`, which is where Supabase
-- expects them and where the generated types will not trip over them.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
