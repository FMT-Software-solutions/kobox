import type { PlanFrequency } from './domain';

/**
 * Client-side mirror of the cycle maths in
 * supabase/migrations/20260802030000_plan_backfill.sql.
 *
 * This exists purely to tell the user what a start date will do *before* they
 * commit — "this creates 5 monthly periods from April 2026". The database
 * remains the authority; if these two ever disagree, the database is right.
 *
 * All arithmetic is in UTC. Local-time date maths silently shifts by a day
 * across DST boundaries, which would mis-count periods near a month edge.
 */

/** Build a UTC date at midnight, month is zero-based. */
export function utcDate(year: number, month: number, day = 1): Date {
  return new Date(Date.UTC(year, month, day));
}

/** `YYYY-MM-DD` for sending to Postgres. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function nextCycleStart(frequency: PlanFrequency, start: Date): Date | null {
  const next = new Date(start.getTime());

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    case 'biweekly':
      next.setUTCDate(next.getUTCDate() + 14);
      return next;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      return next;
    case 'quarterly':
      next.setUTCMonth(next.getUTCMonth() + 3);
      return next;
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      return next;
    case 'once':
      return null;
  }
}

/** Matches the c_max_cycles guard in generate_due_cycles. */
export const MAX_CYCLES = 520;

/**
 * How many collection periods exist from `start` through `upTo` inclusive.
 * Returns MAX_CYCLES at most — the database refuses beyond that.
 */
export function countCycles(
  frequency: PlanFrequency,
  start: Date,
  upTo: Date = new Date()
): number {
  if (start > upTo) return 0;
  if (frequency === 'once') return 1;

  let cursor = start;
  let count = 0;

  while (cursor <= upTo && count < MAX_CYCLES) {
    count++;
    const next = nextCycleStart(frequency, cursor);
    if (next === null || next <= cursor) break;
    cursor = next;
  }

  return count;
}

/**
 * The first scheduled period that has not opened yet.
 *
 * Mirrors the database: periods are issued from the plan's start date at its
 * frequency, up to today. The next one is therefore the first scheduled start
 * after today — and that is when a changed amount first applies.
 *
 * Returns null for one-off collections, which have no next period.
 */
export function nextPeriodStart(
  frequency: PlanFrequency,
  planStart: Date,
  upTo: Date = new Date()
): Date | null {
  if (frequency === 'once') return null;

  let cursor = planStart;
  let guard = 0;

  while (cursor <= upTo && guard < MAX_CYCLES) {
    const next = nextCycleStart(frequency, cursor);
    if (next === null || next <= cursor) return null;
    cursor = next;
    guard++;
  }

  return cursor > upTo ? cursor : null;
}

/**
 * How many whole future periods a credit balance covers, and what that means in
 * plain words.
 *
 * Future cycles deliberately do not exist yet — you do not *owe* September in
 * August, and creating those obligations early would inflate every arrears
 * figure in the app. Coverage is therefore derived from credit rather than
 * stored, which is why this lives here and not in the database.
 */
export function describeCoverage(
  credit: number,
  amountPerPeriod: number | null,
  frequency: PlanFrequency
): string | null {
  if (credit <= 0 || amountPerPeriod === null || amountPerPeriod <= 0) return null;
  if (frequency === 'once') return null;

  const periods = Math.floor(credit / amountPerPeriod);
  if (periods < 1) return null;

  const noun = PERIOD_NOUN[frequency];
  return `Covers ${periods} more ${periods === 1 ? noun : `${noun}s`}`;
}

const PERIOD_NOUN: Record<PlanFrequency, string> = {
  daily: 'day',
  weekly: 'week',
  biweekly: 'fortnight',
  monthly: 'month',
  quarterly: 'quarter',
  yearly: 'year',
  once: 'one-off collection',
};

/** Plain-language summary of what backdating a plan will do. */
export function describeBackfill(
  frequency: PlanFrequency,
  start: Date,
  upTo: Date = new Date()
): string {
  const count = countCycles(frequency, start, upTo);
  const monthName = start.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const from = `${monthName} ${start.getUTCFullYear()}`;

  if (count === 0) {
    return `Starts ${from}. Nothing is owed until then.`;
  }
  if (frequency === 'once') {
    // One-offs run between two real dates; the caller shows those instead.
    return 'Collected once.';
  }

  const noun = PERIOD_NOUN[frequency];
  const plural = count === 1 ? noun : `${noun}s`;
  return `${count} ${plural} will be opened, from ${from} to today.`;
}
