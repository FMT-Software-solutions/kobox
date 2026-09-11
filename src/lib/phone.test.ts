import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatGhanaPhone,
  ghanaNetwork,
  isGhanaPhone,
  maskGhanaPhone,
  parseGhanaPhone,
  toE164,
} from './phone.ts';

/** The failure reason, or 'ok' when it parsed. Keeps the narrowing in one place. */
function problemOf(input: string): string {
  const result = parseGhanaPhone(input);
  return result.ok ? 'ok' : result.problem;
}

describe('parseGhanaPhone', () => {
  it('accepts every way a Ghanaian writes their own number', () => {
    // All of these are the same person.
    const same = [
      '0241234567',
      '024 123 4567',
      '024-123-4567',
      '(024) 123 4567',
      '241234567',
      '+233241234567',
      '+233 24 123 4567',
      '233241234567',
      '00233241234567',
      '  0241234567  ',
    ];

    for (const input of same) {
      assert.equal(toE164(input), '+233241234567', `failed on ${input}`);
    }
  });

  it('drops the trunk zero when someone pastes the country code in front of it', () => {
    // +233 024... is wrong, and extremely common. Fix it rather than refuse.
    assert.equal(toE164('+2330241234567'), '+233241234567');
    assert.equal(toE164('2330241234567'), '+233241234567');
  });

  it('accepts all the mobile prefixes in use', () => {
    for (const prefix of [
      '20',
      '23',
      '24',
      '25',
      '26',
      '27',
      '50',
      '53',
      '54',
      '55',
      '56',
      '57',
      '59',
    ]) {
      assert.ok(isGhanaPhone(`0${prefix}1234567`), `0${prefix} should be valid`);
    }
  });

  it('names a landline instead of just refusing it', () => {
    const result = parseGhanaPhone('0302123456');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.problem, 'landline');
    assert.match(result.ok === false ? result.message : '', /mobile/i);
  });

  it('rejects a number that is the wrong length', () => {
    for (const input of ['024123456', '02412345678', '1', '024 123 456']) {
      assert.equal(isGhanaPhone(input), false, `${input} should be rejected`);
    }
  });

  it('rejects a foreign number as foreign, not as a typo', () => {
    const result = parseGhanaPhone('+2348012345678');
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.problem, 'not-ghana');
  });

  it('reports an empty field separately from a malformed one', () => {
    // An untouched field and a mistyped one need different messages.
    assert.equal(problemOf(''), 'empty');
    assert.equal(problemOf('   '), 'empty');
    assert.equal(problemOf('024 123'), 'malformed');
  });

  it('is idempotent — normalising twice changes nothing', () => {
    const once = toE164('024 123 4567')!;
    assert.equal(toE164(once), once);
  });
});

describe('formatGhanaPhone', () => {
  it('renders the local form people actually read', () => {
    assert.equal(formatGhanaPhone('+233241234567'), '024 123 4567');
    assert.equal(formatGhanaPhone('0241234567'), '024 123 4567');
  });

  it('round-trips with parseGhanaPhone', () => {
    const e164 = '+233201234567';
    assert.equal(toE164(formatGhanaPhone(e164)), e164);
  });

  it('leaves anything it cannot parse alone rather than throwing', () => {
    // Legacy rows written before normalisation still have to render in a list.
    assert.equal(formatGhanaPhone('not a phone'), 'not a phone');
  });
});

describe('maskGhanaPhone', () => {
  it('keeps the last four so the owner recognises it, hides the middle', () => {
    assert.equal(maskGhanaPhone('+233241234567'), '024 ••• 4567');
  });

  it('never reveals the middle digits', () => {
    assert.ok(!maskGhanaPhone('+233241234567').includes('123'));
  });
});

describe('ghanaNetwork', () => {
  it('names the network for display', () => {
    assert.equal(ghanaNetwork('0241234567'), 'MTN');
    assert.equal(ghanaNetwork('0201234567'), 'Telecel');
    assert.equal(ghanaNetwork('0271234567'), 'AirtelTigo');
  });

  it('returns null for an unknown prefix rather than guessing', () => {
    // A range the NCA allocates later must not break anything.
    assert.equal(ghanaNetwork('0221234567'), null);
  });

  it('still validates a number whose network it does not know', () => {
    // The whole point: display is best-effort, validation is structural.
    assert.ok(isGhanaPhone('0221234567'));
  });
});
