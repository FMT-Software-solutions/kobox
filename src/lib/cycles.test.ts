import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  countCycles,
  describeCoverage,
  MAX_CYCLES,
  nextCycleStart,
  nextPeriodStart,
  toIsoDate,
  utcDate,
} from './cycles.ts';

describe('nextPeriodStart', () => {
  it('is the first scheduled period after today', () => {
    // Monthly plan started April; today is 3 August -> next is 1 September.
    const next = nextPeriodStart('monthly', utcDate(2026, 3), utcDate(2026, 7, 3));
    assert.equal(toIsoDate(next!), '2026-09-01');
  });

  it('keeps the plan own day-of-month alignment', () => {
    // Started on the 15th, so periods run 15th to 14th.
    const next = nextPeriodStart('monthly', utcDate(2026, 3, 15), utcDate(2026, 7, 3));
    assert.equal(toIsoDate(next!), '2026-08-15');
  });

  it('handles a plan that has not started yet', () => {
    const next = nextPeriodStart('monthly', utcDate(2026, 9), utcDate(2026, 7, 3));
    assert.equal(toIsoDate(next!), '2026-10-01');
  });

  it('has no next period for a one-off', () => {
    assert.equal(nextPeriodStart('once', utcDate(2026, 3), utcDate(2026, 7, 3)), null);
  });
});

describe('describeCoverage', () => {
  it('reports how many whole periods credit covers', () => {
    // ₵180 paid against ₵20/month dues with ₵100 already owed leaves ₵80 credit.
    assert.equal(describeCoverage(8000, 2000, 'monthly'), 'Covers 4 more months');
    assert.equal(describeCoverage(2000, 2000, 'monthly'), 'Covers 1 more month');
  });

  it('ignores a part-period of credit', () => {
    assert.equal(describeCoverage(1500, 2000, 'monthly'), null);
  });

  it('says nothing for one-off or open contributions', () => {
    assert.equal(describeCoverage(5000, 2000, 'once'), null);
    assert.equal(describeCoverage(5000, null, 'monthly'), null);
  });

  it('says nothing when there is no credit', () => {
    assert.equal(describeCoverage(0, 2000, 'monthly'), null);
  });
});

describe('nextCycleStart', () => {
  it('advances by the right interval', () => {
    const start = utcDate(2026, 3); // 1 April 2026
    assert.equal(toIsoDate(nextCycleStart('daily', start)!), '2026-04-02');
    assert.equal(toIsoDate(nextCycleStart('weekly', start)!), '2026-04-08');
    assert.equal(toIsoDate(nextCycleStart('biweekly', start)!), '2026-04-15');
    assert.equal(toIsoDate(nextCycleStart('monthly', start)!), '2026-05-01');
    assert.equal(toIsoDate(nextCycleStart('quarterly', start)!), '2026-07-01');
    assert.equal(toIsoDate(nextCycleStart('yearly', start)!), '2027-04-01');
  });

  it('has no next period for a one-off', () => {
    assert.equal(nextCycleStart('once', utcDate(2026, 3)), null);
  });

  it('rolls over a year boundary', () => {
    assert.equal(toIsoDate(nextCycleStart('monthly', utcDate(2026, 11))!), '2027-01-01');
  });
});

describe('countCycles', () => {
  it('counts April through August inclusive as five months', () => {
    // The case that prompted this: group starts using Kobox in August,
    // but dues actually began in April.
    const count = countCycles('monthly', utcDate(2026, 3), utcDate(2026, 7, 2));
    assert.equal(count, 5);
  });

  it('counts a single period when starting this month', () => {
    assert.equal(countCycles('monthly', utcDate(2026, 7), utcDate(2026, 7, 15)), 1);
  });

  it('counts nothing for a future start', () => {
    assert.equal(countCycles('monthly', utcDate(2027, 0), utcDate(2026, 7, 2)), 0);
  });

  it('treats a one-off as exactly one period', () => {
    assert.equal(countCycles('once', utcDate(2026, 3), utcDate(2026, 7)), 1);
  });

  it('counts weeks without drifting', () => {
    // 1 Apr to 29 Apr is 5 weekly periods: 1, 8, 15, 22, 29.
    assert.equal(countCycles('weekly', utcDate(2026, 3), utcDate(2026, 3, 29)), 5);
  });

  it('never exceeds the database guard', () => {
    const count = countCycles('daily', utcDate(2000, 0), utcDate(2026, 7));
    assert.equal(count, MAX_CYCLES);
  });
});
