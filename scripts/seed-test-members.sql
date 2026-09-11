-- Seed ~20 test members into the real group.
--
-- Run this in the Supabase dashboard → SQL Editor. It runs as `postgres`, so it
-- bypasses RLS — which is the point: the anon key plus the ledger test account
-- in .env can only ever see that account's own groups, never yours.
--
-- Safe to re-run: members are matched by name, so a second run adds nobody.
--
-- It deliberately does NOT call add_member(). That RPC checks
-- has_group_role(..., 'admin') against auth.uid(), and there is no signed-in
-- user in the SQL editor. Instead it does exactly what add_member does: insert
-- the member, then issue obligations for every OPEN period of every active
-- plan, using plan_obligation_amount() so susu audiences, tag audiences and
-- per-member exemptions are all honoured.

do $$
declare
  v_group_id uuid;
  v_group_name text;
  v_count int;
  v_added int := 0;
  v_issued int := 0;
  v_member_id uuid;
  r record;

  -- Name, phone. All plain members: none of them have a Kobox login, which is
  -- the normal case — the treasurer records on their behalf.
  c_people constant text[][] := array[
    ['Kwabena Mensah',      '+233241000001'],
    ['Ama Serwaa',          '+233241000002'],
    ['Kofi Boateng',        '+233241000003'],
    ['Akosua Darko',        '+233241000004'],
    ['Yaw Owusu',           '+233241000005'],
    ['Abena Nyarko',        '+233241000006'],
    ['Kwame Asante',        '+233241000007'],
    ['Efua Amankwah',       '+233241000008'],
    ['Kojo Appiah',         '+233241000009'],
    ['Adwoa Frimpong',      '+233241000010'],
    ['Kwesi Ofori',         '+233241000011'],
    ['Esi Baidoo',          '+233241000012'],
    ['Fiifi Quaye',         '+233241000013'],
    ['Araba Tetteh',        '+233241000014'],
    ['Nana Agyeman',        '+233241000015'],
    ['Maame Dapaah',        '+233241000016'],
    ['Kwaku Antwi',         '+233241000017'],
    ['Afia Bonsu',          '+233241000018'],
    ['Kobina Sarpong',      '+233241000019'],
    ['Adjoa Mensimah',      '+233241000020']
  ];
begin
  -- Find the one real group. Ledger scratch groups are excluded by name; if the
  -- answer is ambiguous, stop rather than guess and seed the wrong books.
  select count(*) into v_count
  from groups
  where name not like 'Ledger — %';

  if v_count = 0 then
    raise exception 'No non-scratch group found. Create your group in the app first.';
  elsif v_count > 1 then
    raise exception
      'Found % candidate groups. Set v_group_id by hand instead of letting this guess.', v_count;
  end if;

  select id, name into v_group_id, v_group_name
  from groups
  where name not like 'Ledger — %';

  raise notice 'Seeding into "%" (%)', v_group_name, v_group_id;

  for i in 1 .. array_length(c_people, 1) loop
    -- Matched by name so re-running is a no-op rather than 20 duplicates.
    if exists (
      select 1 from group_members
      where group_id = v_group_id and lower(full_name) = lower(c_people[i][1])
    ) then
      continue;
    end if;

    insert into group_members (group_id, user_id, full_name, phone, role, status)
    values (v_group_id, null, c_people[i][1], c_people[i][2], 'member', 'active')
    returning id into v_member_id;

    v_added := v_added + 1;

    -- Exactly what add_member does: bill the periods that are still open, and
    -- let plan_obligation_amount decide whether this plan bills them at all.
    insert into obligations (cycle_id, member_id, amount_due)
    select c.id, v_member_id, plan_obligation_amount(p.id, v_member_id)
    from cycles c
    join plans p on p.id = c.plan_id
    where p.group_id = v_group_id
      and p.status = 'active'
      and c.status = 'open'
      and plan_obligation_amount(p.id, v_member_id) is not null
    on conflict (cycle_id, member_id) do nothing;

    get diagnostics v_count = row_count;
    v_issued := v_issued + v_count;
  end loop;

  raise notice 'Added % members, issued % obligations.', v_added, v_issued;

  for r in
    select role, status, count(*) as n
    from group_members
    where group_id = v_group_id
    group by role, status
    order by role
  loop
    raise notice '  % / % : %', r.role, r.status, r.n;
  end loop;
end;
$$;
