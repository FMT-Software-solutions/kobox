-- "Sent to 1 person" must not read as 0.
--
-- `group_message_history` counted recipients as outbox rows. But a member who
-- can be reached by neither text nor push gets no row at all —
-- `enqueue_notification` returns without writing one — so a message addressed
-- to one such person reported zero recipients, and the history said the admin
-- had written to nobody. They had; it simply could not be delivered, which is a
-- different fact and one the admin needs.
--
-- `recipients` now reads the snapshot taken at send time (who it was ADDRESSED
-- to). The per-channel counts still come from the rows (what actually
-- happened), and the gap between the two is who could not be reached.
--
-- Same return type, so this replaces rather than overloads.

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
      gm.recipient_count,
      (count(n.id) filter (where n.sms_sent))::int,
      (count(n.id) filter (where n.sms_status = 'DELIVERED'))::int,
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

-- Privileges survive a replace; restated regardless, naming every grantee.
revoke execute on function group_message_history(uuid) from public, anon;
grant execute on function group_message_history(uuid) to authenticated;
