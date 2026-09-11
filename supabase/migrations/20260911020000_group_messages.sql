-- Group messages: an admin writes to everyone, a tag, or chosen members.
--
-- Built ON the notification outbox, not beside it. A message becomes one
-- `notifications` row per recipient, so everything the outbox already does
-- applies without being written twice: member preferences, the credit and cap
-- checks, dedupe, GSM-7 normalisation, push for app users, delivery receipts.
-- The alternative — the app calling fmt-ss-backend's `/sms/send` directly —
-- would have put the authorisation check in the client, and that endpoint
-- takes any organisation id it is given.
--
-- The money rule is all-or-nothing. If the group cannot afford to text every
-- recipient who would be texted, the message is REFUSED rather than sent to
-- whoever the credit happens to reach first. A meeting notice that arrives for
-- thirty people and silently not for the other ten is worse than one that did
-- not go at all, because the admin believes it went. The admin may instead
-- choose to send it by push only.

-- ---------------------------------------------------------------------------
-- The record of what was sent
-- ---------------------------------------------------------------------------

create table if not exists group_messages (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references groups (id) on delete cascade,
  sent_by     uuid references group_members (id) on delete set null,
  body        text not null check (length(trim(body)) between 1 and 900),
  audience    text not null check (audience in ('everyone', 'tag', 'members')),
  tag_id      uuid references tags (id) on delete set null,
  push_only   boolean not null default false,
  -- Snapshots at send time. What actually happened is read from the outbox
  -- rows, which the dispatcher and the delivery webhook keep up to date.
  recipient_count   int not null default 0,
  credits_estimated int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists group_messages_group_idx
  on group_messages (group_id, created_at desc);

alter table group_messages enable row level security;

-- Admins read the history. Nobody writes it except `send_group_message`.
create policy group_messages_read on group_messages
  for select using (has_group_role(group_id, 'admin'));

alter table notifications
  add column if not exists message_id uuid references group_messages (id) on delete cascade;

create index if not exists notifications_message_idx
  on notifications (message_id)
  where message_id is not null;

-- ---------------------------------------------------------------------------
-- What a text costs
--
-- Credits = segments per recipient. GSM-7 fits 160 characters in one segment
-- (153 each once split); a single character outside GSM-7 turns the whole
-- message into UCS-2 at 70 (67 once split). Extension characters such as `€`
-- and `[` take two GSM-7 slots.
--
-- The text is normalised FIRST, exactly as the dispatcher normalises it before
-- sending: curly quotes, dashes, typographic spaces and ellipses become their
-- ASCII twins, and braces are stripped. Estimating the raw text would charge a
-- group three credits for a message that is really sent as one.
--
-- This rule also exists in `src/lib/sms.ts`, for the live counter in the
-- composer. Two copies of a rule is the mistake HANDOFF keeps recording, so a
-- ledger check feeds both the same corpus and asserts they agree. Change one,
-- change the other, run `npm run test:ledger`.
-- ---------------------------------------------------------------------------

-- Written as \u escapes, never as literal characters. translate() maps by
-- POSITION, and half of these are invisible (typographic spaces, zero-width
-- joiners); one wrong code point in an editor shifts every mapping after it.
-- The code points are the dispatcher's GSM7_GROUPS, in the same order.
create or replace function sms_normalise(p_text text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(
    translate(
      coalesce(p_text, ''),
      -- dashes, bullet, dots                    -> '-'   (8)
      E'\u2013\u2014\u2015\u2011\u2212\u2022\u00B7\u2027'
      -- single curly quotes, prime               -> apostrophe (5)
      || E'\u2018\u2019\u201A\u201B\u2032'
      -- double curly quotes, double prime        -> '"'   (4)
      || E'\u201C\u201D\u201E\u2033'
      -- multiplication sign                      -> 'x'   (1)
      || E'\u00D7'
      -- no-break and typographic spaces          -> ' '   (13)
      || E'\u00A0\u202F\u2007\u2009\u200A\u2002\u2003\u2004\u2005\u2006\u2008\u205F\u3000'
      -- zero-width characters: no counterpart in the second argument, which
      -- is how translate() is told to delete them            (4)
      || E'\u200B\uFEFF\u200C\u200D',
      repeat('-', 8) || repeat('''', 5) || repeat('"', 4) || 'x' || repeat(' ', 13)
    ),
    E'\u2026', '...'), '{', ''), '}', '');
$$;

create or replace function sms_credit_estimate(p_text text)
returns int
language plpgsql
immutable
as $$
declare
  v_text  text := sms_normalise(p_text);
  -- GSM 03.38 basic set, then the extension table (two slots each). Escaped
  -- for the same reason as sms_normalise; src/lib/sms.ts holds the same list.
  v_basic text := E'@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5'
               || E'\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\u00C6\u00E6\u00DF\u00C9'
               || E' !"#\u00A4%&\'()*+,-./0123456789:;<=>?\u00A1'
               || 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
               || E'\u00C4\u00D6\u00D1\u00DC\u00A7\u00BF'
               || 'abcdefghijklmnopqrstuvwxyz'
               || E'\u00E4\u00F6\u00F1\u00FC\u00E0';
  v_ext   text := E'^{}\\[~]|\u20AC';
  v_char  text;
  v_gsm   int := 0;
  v_ucs   int := 0;
  v_is_gsm boolean := true;
begin
  if v_text = '' then
    return 0;
  end if;

  for i in 1 .. length(v_text) loop
    v_char := substr(v_text, i, 1);

    -- UCS-2 length: characters beyond the Basic Multilingual Plane (emoji,
    -- mostly) are a surrogate pair — two units, not one.
    v_ucs := v_ucs + case when ascii(v_char) > 65535 then 2 else 1 end;

    if v_is_gsm then
      if position(v_char in v_basic) > 0 then
        v_gsm := v_gsm + 1;
      elsif position(v_char in v_ext) > 0 then
        v_gsm := v_gsm + 2;
      else
        v_is_gsm := false;
      end if;
    end if;
  end loop;

  if v_is_gsm then
    return case when v_gsm <= 160 then 1 else ceil(v_gsm / 153.0)::int end;
  end if;

  return case when v_ucs <= 70 then 1 else ceil(v_ucs / 67.0)::int end;
end;
$$;

-- Pure functions of their input; nothing to protect. Granted so the ledger
-- checks can hold the SQL copy against the TypeScript one.
grant execute on function sms_normalise(text) to authenticated;
grant execute on function sms_credit_estimate(text) to authenticated;

-- ---------------------------------------------------------------------------
-- What a recipient actually receives
--
-- `{name}` becomes the member's first name — "Ama, the meeting has moved" reads
-- as a message to a person, not a broadcast. The SMS is prefixed with the
-- group's name while the group sends as the shared `Kobox` sender ID: without
-- it, a member in three groups cannot tell which one is writing. A group with
-- its own approved sender ID has already said who it is.
-- ---------------------------------------------------------------------------

create or replace function message_push_text(p_body text, p_full_name text)
returns text
language sql
immutable
as $$
  select replace(p_body, '{name}', split_part(trim(p_full_name), ' ', 1));
$$;

create or replace function message_sms_text(
  p_group_name text,
  p_sender_id  text,
  p_body       text,
  p_full_name  text
)
returns text
language sql
immutable
as $$
  select case
    when p_sender_id is null or p_sender_id = '' then p_group_name || ': '
    else ''
  end || message_push_text(p_body, p_full_name);
$$;

-- ---------------------------------------------------------------------------
-- Who a message reaches
--
-- The single definition of the audience, used by both the preview and the send
-- so the numbers an admin is shown are the numbers that happen.
--
-- The sender is left out of "everyone" and "a tag" — nobody needs to be texted
-- the notice they have just written — but kept when chosen by name, because
-- choosing yourself is a deliberate act (and is how you test a message).
--
-- `can_push` requires a registered device, not merely an account: an account
-- that has never opened the app on a phone has nowhere to push to, and
-- counting it would promise a reach the message does not have.
-- ---------------------------------------------------------------------------

create or replace function message_recipients(
  p_group_id   uuid,
  p_audience   text,
  p_tag_id     uuid,
  p_member_ids uuid[]
)
returns table (
  member_id  uuid,
  full_name  text,
  can_sms    boolean,
  can_push   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.full_name,
    m.phone_e164 is not null and coalesce(np.sms_enabled, true),
    m.user_id is not null
      and coalesce(np.push_enabled, true)
      and exists (select 1 from expo_push_tokens t where t.user_id = m.user_id)
  from group_members m
  left join notification_preferences np on np.member_id = m.id
  where m.group_id = p_group_id
    and m.status = 'active'
    and case p_audience
      when 'everyone' then m.user_id is distinct from auth.uid()
      when 'tag' then m.user_id is distinct from auth.uid()
        and exists (
          select 1 from member_tags mt
          where mt.member_id = m.id and mt.tag_id = p_tag_id
        )
      when 'members' then m.id = any(coalesce(p_member_ids, '{}'))
      else false
    end;
$$;

-- ---------------------------------------------------------------------------
-- The preview
--
-- Everything the composer needs to be honest before the admin presses send:
-- how many people, how many by text and at what cost, how many by push, how
-- many cannot be reached at all, and whether the group can afford it.
-- ---------------------------------------------------------------------------

create or replace function preview_group_message(
  p_group_id   uuid,
  p_body       text,
  p_audience   text,
  p_tag_id     uuid default null,
  p_member_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group     groups;
  v_balance   int;
  v_cap_left  int;
  v_total     int := 0;
  v_by_sms    int := 0;
  v_by_push   int := 0;
  v_neither   int := 0;
  v_credits   int := 0;
  r           record;
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin can message the group';
  end if;

  select * into v_group from groups where id = p_group_id;

  select coalesce(credit_balance, 0) into v_balance
    from organization_sms_balances where organization_id = p_group_id;

  v_cap_left := greatest(0, v_group.sms_monthly_cap - group_sms_used_this_month(p_group_id));

  for r in select * from message_recipients(p_group_id, p_audience, p_tag_id, p_member_ids) loop
    v_total := v_total + 1;

    if r.can_sms and v_group.sms_enabled then
      v_by_sms  := v_by_sms + 1;
      v_credits := v_credits + sms_credit_estimate(
        message_sms_text(v_group.name, v_group.sms_sender_id, coalesce(p_body, ''), r.full_name)
      );
    end if;

    if r.can_push then
      v_by_push := v_by_push + 1;
    end if;

    if not (r.can_sms and v_group.sms_enabled) and not r.can_push then
      v_neither := v_neither + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'recipients',  v_total,
    'bySms',       v_by_sms,
    'byPush',      v_by_push,
    'unreachable', v_neither,
    'credits',     v_credits,
    'balance',     coalesce(v_balance, 0),
    'capLeft',     v_cap_left,
    'smsEnabled',  v_group.sms_enabled,
    -- The single yes/no the composer acts on. Push-only is always possible.
    'affordable',  v_credits <= least(coalesce(v_balance, 0), v_cap_left)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The send
-- ---------------------------------------------------------------------------

create or replace function send_group_message(
  p_group_id   uuid,
  p_body       text,
  p_audience   text,
  p_tag_id     uuid default null,
  p_member_ids uuid[] default null,
  p_push_only  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group    groups;
  v_body     text := trim(coalesce(p_body, ''));
  v_preview  jsonb;
  v_texting  boolean;
  v_message  uuid;
  v_key      text;
  r          record;
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin can message the group';
  end if;

  if v_body = '' then
    raise exception 'Write a message first';
  end if;

  if length(v_body) > 900 then
    raise exception 'That message is too long — keep it under 900 characters';
  end if;

  if p_audience = 'tag' and not exists (
    select 1 from tags where id = p_tag_id and group_id = p_group_id
  ) then
    raise exception 'That tag is not in this group';
  end if;

  select * into v_group from groups where id = p_group_id;

  v_preview := preview_group_message(p_group_id, v_body, p_audience, p_tag_id, p_member_ids);

  if (v_preview ->> 'recipients')::int = 0 then
    raise exception 'Nobody to send this to';
  end if;

  v_texting := not p_push_only and (v_preview ->> 'bySms')::int > 0;

  -- All-or-nothing. See the header.
  if v_texting and not (v_preview ->> 'affordable')::boolean then
    raise exception 'This needs % credits to text everyone, and the group can spend % right now. Buy credits, or send it by push only.',
      v_preview ->> 'credits',
      least((v_preview ->> 'balance')::int, (v_preview ->> 'capLeft')::int);
  end if;

  insert into group_messages (
    group_id, sent_by, body, audience, tag_id, push_only,
    recipient_count, credits_estimated
  )
  values (
    p_group_id, current_member_id(p_group_id), v_body, p_audience,
    case when p_audience = 'tag' then p_tag_id end, p_push_only,
    (v_preview ->> 'recipients')::int,
    case when v_texting then (v_preview ->> 'credits')::int else 0 end
  )
  returning id into v_message;

  for r in select * from message_recipients(p_group_id, p_audience, p_tag_id, p_member_ids) loop
    v_key := 'message:' || v_message::text || ':' || r.member_id::text;

    perform enqueue_notification(
      p_group_id,
      r.member_id,
      'message',
      v_group.name,
      message_push_text(v_body, r.full_name),
      message_sms_text(v_group.name, v_group.sms_sender_id, v_body, r.full_name),
      v_key
    );

    update notifications
       set message_id = v_message,
           -- Push only was chosen, or nothing is being texted: make sure the
           -- dispatcher cannot text this row even if the group gains credit
           -- in the minute before it runs.
           want_sms   = want_sms and v_texting
     where dedupe_key = v_key;
  end loop;

  -- Wake the dispatcher now rather than waiting up to a minute for cron. It is
  -- a no-op when app_config is not filled in, and pg_net is asynchronous, so
  -- this does not hold the transaction open on the network.
  perform dispatch_notifications();

  return v_preview || jsonb_build_object('messageId', v_message, 'pushOnly', not v_texting);
end;
$$;

-- ---------------------------------------------------------------------------
-- The history
--
-- Counts come from the outbox rows, which only their addressee may read, so
-- this is SECURITY DEFINER behind an explicit admin check.
-- ---------------------------------------------------------------------------

create or replace function group_message_history(p_group_id uuid)
returns table (
  id          uuid,
  body        text,
  audience    text,
  tag_name    text,
  sent_by     text,
  created_at  timestamptz,
  push_only   boolean,
  recipients  int,
  texted      int,
  delivered   int,
  not_texted  int,
  pushed      int,
  waiting     int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_group_role(p_group_id, 'admin') then
    raise exception 'Only an admin can read the group''s messages';
  end if;

  return query
    select
      gm.id,
      gm.body,
      gm.audience,
      t.name,
      s.full_name,
      gm.created_at,
      gm.push_only,
      count(n.id)::int,
      (count(n.id) filter (where n.sms_sent))::int,
      (count(n.id) filter (where n.sms_status = 'DELIVERED'))::int,
      -- Meant to be texted, already processed, and not texted: out of credit
      -- mid-run, a bad number, or the provider refused it.
      (count(n.id) filter (where n.want_sms and n.status = 'sent' and not n.sms_sent))::int,
      (count(n.id) filter (where n.push_sent))::int,
      (count(n.id) filter (where n.status = 'pending'))::int
    from group_messages gm
    left join notifications n on n.message_id = gm.id
    left join tags t on t.id = gm.tag_id
    left join group_members s on s.id = gm.sent_by
    where gm.group_id = p_group_id
    group by gm.id, t.name, s.full_name
    order by gm.created_at desc
    limit 100;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — naming every grantee (HANDOFF: two revokes, and neither alone works)
-- ---------------------------------------------------------------------------

-- Internal: they take a group id and check nothing.
revoke execute on function message_recipients(uuid, text, uuid, uuid[]) from public, anon, authenticated;

-- App-facing, each with its own admin check inside.
revoke execute on function preview_group_message(uuid, text, text, uuid, uuid[]) from public, anon;
revoke execute on function send_group_message(uuid, text, text, uuid, uuid[], boolean) from public, anon;
revoke execute on function group_message_history(uuid) from public, anon;

grant execute on function preview_group_message(uuid, text, text, uuid, uuid[]) to authenticated;
grant execute on function send_group_message(uuid, text, text, uuid, uuid[], boolean) to authenticated;
grant execute on function group_message_history(uuid) to authenticated;
