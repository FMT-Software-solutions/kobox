-- A yearly contribution does not have to follow the calendar.
--
-- Plenty of groups run their year from whenever they formed, or from the AGM:
-- December 2026 to November 2027 is a perfectly ordinary subscription year, and
-- `cycle_end_for` has always computed it correctly.
--
-- `cycle_label_for` did not. It labelled every yearly period with the year it
-- STARTED in, so that Dec 2026 – Nov 2027 period was called "2026" — eleven
-- months of which are not 2026. Two members reading "2026" and "2027" on
-- consecutive rows would reasonably conclude they had missed a year.
--
-- A group that starts in January gets the clean "2026" it expects; anyone else
-- gets "2026/27", which is how people actually say it.

create or replace function cycle_label_for(p_frequency plan_frequency, p_start date)
returns text
language sql
immutable
as $$
  select case p_frequency
    when 'daily'     then to_char(p_start, 'FMDD Mon YYYY')
    when 'weekly'    then 'Week of ' || to_char(p_start, 'FMDD Mon YYYY')
    when 'biweekly'  then 'Fortnight from ' || to_char(p_start, 'FMDD Mon YYYY')
    when 'monthly'   then to_char(p_start, 'FMMonth YYYY')
    when 'quarterly' then 'Q' || to_char(p_start, 'Q') || ' ' || to_char(p_start, 'YYYY')
    when 'yearly'    then
      case
        -- A calendar year is just the year.
        when extract(month from p_start) = 1 then to_char(p_start, 'YYYY')
        -- Anything else spans two, and says so: "2026/27".
        else to_char(p_start, 'YYYY') || '/' ||
             to_char((p_start + interval '1 year')::date, 'YY')
      end
    when 'once'      then 'One time'
  end;
$$;

-- Labels are stored on the row at creation, so existing periods keep whatever
-- they were given. Recompute the yearly ones — the label is display-only, and
-- leaving half the app saying "2026" for a period ending in November 2027 is
-- the confusion this migration exists to remove.
update cycles c
   set label = cycle_label_for(p.frequency, c.period_start)
  from plans p
 where p.id = c.plan_id
   and p.frequency = 'yearly'
   and c.label is distinct from cycle_label_for(p.frequency, c.period_start);
