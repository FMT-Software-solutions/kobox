import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  completionPercent,
  formatMoney,
  parseMoney,
  splitMoney,
  sumMoney,
  type Minor,
} from './money.ts';

describe('parseMoney', () => {
  it('parses plain decimals', () => {
    assert.equal(parseMoney('12.50'), 1250);
    assert.equal(parseMoney('12'), 1200);
    assert.equal(parseMoney('12.5'), 1250);
    assert.equal(parseMoney('0.01'), 1);
    assert.equal(parseMoney('-5.00'), -500);
  });

  it('treats comma as thousands grouping and discards it', () => {
    assert.equal(parseMoney('1,250'), 125000);
    assert.equal(parseMoney('1,250.75'), 125075);
  });

  it('always treats "." as the decimal point', () => {
    // Regression: an earlier heuristic guessed from digit grouping and read
    // "12.999" as 12,999 — a 1000x error. Never infer, always apply the rule.
    assert.equal(parseMoney('12.999'), 1299);
    assert.equal(parseMoney('1.500'), 150);
  });

  it('ignores currency symbols and surrounding whitespace', () => {
    assert.equal(parseMoney('  ₵12.50 '), 1250);
  });

  it('returns null rather than guessing at malformed input', () => {
    assert.equal(parseMoney(''), null);
    assert.equal(parseMoney('abc'), null);
    assert.equal(parseMoney('.'), null);
    assert.equal(parseMoney('-'), null);
    assert.equal(parseMoney('12.34.56'), null);
  });
});

describe('formatMoney', () => {
  it('formats minor units for display', () => {
    assert.equal(formatMoney(1250), '₵12.50');
    assert.equal(formatMoney(0), '₵0.00');
    assert.equal(formatMoney(1), '₵0.01');
    assert.equal(formatMoney(1248000), '₵12,480.00');
    assert.equal(formatMoney(-500), '-₵5.00');
  });

  it('round-trips through parseMoney', () => {
    for (const amount of [0, 1, 99, 100, 12345, 999999, -4200]) {
      const text = formatMoney(amount, 'GHS', { showSymbol: false });
      assert.equal(parseMoney(text), amount, `round trip failed for ${amount}`);
    }
  });
});

describe('splitMoney', () => {
  it('always sums back to the original amount', () => {
    const cases: [Minor, number][] = [
      [10000, 3],
      [100, 3],
      [1, 3],
      [0, 4],
      [999, 7],
      [-10000, 3],
    ];

    for (const [total, parts] of cases) {
      const split = splitMoney(total, parts);
      assert.equal(split.length, parts);
      assert.equal(sumMoney(split), total, `${total} split ${parts} ways lost money`);
    }
  });

  it('distributes the remainder one minor unit at a time', () => {
    assert.deepEqual(splitMoney(10000, 3), [3334, 3333, 3333]);
  });

  it('returns nothing for a non-positive number of parts', () => {
    assert.deepEqual(splitMoney(100, 0), []);
  });
});

describe('completionPercent', () => {
  it('clamps to 0-100 and survives a zero expectation', () => {
    assert.equal(completionPercent(5000, 10000), 50);
    assert.equal(completionPercent(20000, 10000), 100);
    assert.equal(completionPercent(0, 0), 0);
    assert.equal(completionPercent(100, 0), 100);
  });
});
