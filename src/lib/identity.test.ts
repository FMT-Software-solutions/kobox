import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSignInHint, maskEmail } from './identity.ts';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    assert.equal(maskEmail('ama@example.com'), 'a•••@example.com');
    assert.equal(maskEmail('kwabena.mensah@gmail.com'), 'k•••@gmail.com');
  });

  it('never reveals the rest of the local part', () => {
    assert.ok(!maskEmail('shadrack@fmtsoftware.com').includes('hadrack'));
  });

  it('hides anything it cannot parse rather than passing it through', () => {
    // Leaking an unrecognised value whole is the one outcome worse than useless.
    assert.equal(maskEmail('not-an-email'), '•••');
    assert.equal(maskEmail('trailing@'), '•••');
  });

  it('returns empty for empty', () => {
    assert.equal(maskEmail(''), '');
    assert.equal(maskEmail('   '), '');
  });
});

describe('buildSignInHint', () => {
  it('masks a phone the Ghana way', () => {
    assert.equal(buildSignInHint('phone', '0241234567'), '024 ••• 4567');
    assert.equal(buildSignInHint('phone', '+233241234567'), '024 ••• 4567');
  });

  it('masks an email', () => {
    assert.equal(buildSignInHint('email', 'ama@example.com'), 'a•••@example.com');
  });

  it('never returns the identifier unchanged', () => {
    for (const [method, id] of [
      ['phone', '0241234567'],
      ['email', 'ama@example.com'],
    ] as const) {
      assert.notEqual(buildSignInHint(method, id), id);
    }
  });
});
