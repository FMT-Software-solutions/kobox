import type { DateRange } from './api';

/**
 * The windows a treasurer actually reports on.
 *
 * Named presets rather than two date pickers, because "last month" is the
 * question being asked at almost every meeting and making somebody assemble it
 * from two calendars is friction for no gain. A custom range is still there for
 * the year-end.
 */
export type RangePreset = 'this-month' | 'last-month' | 'this-quarter' | 'this-year' | 'all-time';

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** First day of a month, in UTC so a phone's timezone cannot shift the window. */
function startOfMonth(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

function endOfMonth(year: number, month: number): Date {
  // Day 0 of the next month is the last day of this one, leap years included.
  return new Date(Date.UTC(year, month + 1, 0));
}

export function rangeFor(preset: RangePreset, today = new Date()): DateRange {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  switch (preset) {
    case 'this-month':
      return { from: iso(startOfMonth(year, month)), to: iso(endOfMonth(year, month)) };

    case 'last-month':
      return { from: iso(startOfMonth(year, month - 1)), to: iso(endOfMonth(year, month - 1)) };

    case 'this-quarter': {
      const first = Math.floor(month / 3) * 3;
      return { from: iso(startOfMonth(year, first)), to: iso(endOfMonth(year, first + 2)) };
    }

    case 'this-year':
      return { from: iso(startOfMonth(year, 0)), to: iso(endOfMonth(year, 11)) };

    case 'all-time':
      // Before any Kobox group could exist, so the opening balance is zero and
      // the report covers everything ever recorded.
      return { from: '2000-01-01', to: iso(endOfMonth(year, 11)) };
  }
}

export const RANGE_LABEL: Record<RangePreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-quarter': 'This quarter',
  'this-year': 'This year',
  'all-time': 'All time',
};

/** "1 Jun – 30 Jun 2026", for a report header and a filename. */
export function describeRange(range: DateRange): string {
  const from = new Date(`${range.from}T00:00:00Z`);
  const to = new Date(`${range.to}T00:00:00Z`);

  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });

  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return `${fmt(from, !sameYear)} – ${fmt(to, true)}`;
}
