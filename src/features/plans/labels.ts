import type { PlanFrequency, PlanKind } from '@/lib/domain';

/** Plain-language labels — members should never have to decode jargon. */
export const KIND_LABEL: Record<PlanKind, string> = {
  dues: 'Dues',
  contribution: 'Contribution',
  levy: 'One-off levy',
  open: 'Open giving',
  rotating: 'Susu rotation',
  savings: 'Savings',
};

export const FREQUENCY_LABEL: Record<PlanFrequency, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
  once: 'One time',
};

/**
 * "2026-04-01" -> "April 2026".
 * Parsed as UTC; local parsing would shift the date a day behind for anyone
 * west of Greenwich and label the wrong month.
 */
/** "2026-08-15" -> "15 August 2026". UTC-parsed for the same reason. */
export function formatFullDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * How a period reads to a member.
 *
 * A yearly contribution's periods are labelled by year alone — `cycle_label_for`
 * in SQL already returns `to_char(start, 'YYYY')` — so showing "December 2026"
 * for one contradicts every other place the same period is named.
 */
export function formatPeriodLabel(isoDate: string, frequency?: PlanFrequency): string {
  const [year, month] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, 1));

  // Mirrors `cycle_label_for` in SQL: a yearly period that follows the calendar
  // is just the year; one that does not spans two and says so.
  if (frequency === 'yearly') {
    const y = date.getUTCFullYear();
    if (date.getUTCMonth() === 0) return String(y);
    return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
  }

  return `${date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${date.getUTCFullYear()}`;
}
