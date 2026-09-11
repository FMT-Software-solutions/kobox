import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { smsCost, smsNormalise } from './sms.ts';

describe('smsNormalise', () => {
  it('turns typographic punctuation into its GSM-7 twin', () => {
    assert.equal(smsNormalise('Ama’s “dues” — GH₵'), 'Ama\'s "dues" - GH₵');
  });

  it('expands an ellipsis and deletes zero-width characters', () => {
    assert.equal(smsNormalise('wait… now​'), 'wait... now');
  });

  it('strips braces, because the backend reads them as template placeholders', () => {
    assert.equal(smsNormalise('Hi {name}'), 'Hi name');
  });
});

describe('smsCost', () => {
  it('charges nothing for an empty message', () => {
    assert.equal(smsCost('').segments, 0);
  });

  it('fits 160 GSM-7 characters in one credit, and splits at 153 after that', () => {
    assert.equal(smsCost('a'.repeat(160)).segments, 1);
    assert.equal(smsCost('a'.repeat(161)).segments, 2);
    assert.equal(smsCost('a'.repeat(306)).segments, 2);
    assert.equal(smsCost('a'.repeat(307)).segments, 3);
  });

  it('does not let a curly apostrophe triple the price', () => {
    // The whole reason normalisation exists: this is one credit, not three.
    const cost = smsCost(`${'a'.repeat(150)}’s`);
    assert.equal(cost.unicode, false);
    assert.equal(cost.segments, 1);
  });

  it('counts extension characters as two slots', () => {
    assert.equal(smsCost('€'.repeat(80)).segments, 1);
    assert.equal(smsCost('€'.repeat(81)).segments, 2);
  });

  it('falls back to UCS-2 at 70 per credit for anything outside GSM-7', () => {
    const cedi = '₵'; // not in GSM-7
    assert.equal(smsCost(cedi.repeat(70)).unicode, true);
    assert.equal(smsCost(cedi.repeat(70)).segments, 1);
    assert.equal(smsCost(cedi.repeat(71)).segments, 2);
  });

  it('counts an emoji as two UCS-2 units', () => {
    assert.equal(smsCost('\u{1F600}'.repeat(35)).segments, 1);
    assert.equal(smsCost('\u{1F600}'.repeat(36)).segments, 2);
  });
});
