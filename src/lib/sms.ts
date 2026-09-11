/**
 * What a text message costs, before it is sent.
 *
 * An SMS is billed per SEGMENT per recipient. GSM-7 fits 160 characters in one
 * segment (153 each once a message is split); a single character outside
 * GSM-7 forces the whole message into UCS-2, which fits only 70 (67 split).
 * Extension characters such as `€` and `[` take two GSM-7 slots.
 *
 * The text is normalised first, exactly as the dispatcher normalises it before
 * sending — a curly apostrophe from the phone keyboard would otherwise make the
 * counter claim a message costs three times what it really does.
 *
 * THIS RULE EXISTS TWICE: here, for the live counter in the composer, and in
 * SQL as `sms_normalise` / `sms_credit_estimate`, which is what actually
 * decides whether a group can afford a message. A ledger check feeds both the
 * same corpus and asserts they agree. Change one, change the other, and run
 * `npm run test:ledger`.
 */

/** Same code points, same order, as the dispatcher's GSM7_GROUPS. */
const NORMALISE: [string, number[]][] = [
  ['-', [0x2013, 0x2014, 0x2015, 0x2011, 0x2212, 0x2022, 0x00b7, 0x2027]],
  ["'", [0x2018, 0x2019, 0x201a, 0x201b, 0x2032]],
  ['"', [0x201c, 0x201d, 0x201e, 0x2033]],
  ['...', [0x2026]],
  ['x', [0x00d7]],
  [
    ' ',
    [
      0x00a0, 0x202f, 0x2007, 0x2009, 0x200a, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2008,
      0x205f, 0x3000,
    ],
  ],
  ['', [0x200b, 0xfeff, 0x200c, 0x200d]],
];

const REPLACEMENTS = new Map<string, string>();
for (const [replacement, codePoints] of NORMALISE) {
  for (const cp of codePoints) REPLACEMENTS.set(String.fromCodePoint(cp), replacement);
}

/**
 * GSM 03.38 basic set. Written as escapes, exactly as the SQL copy is, so an
 * editor cannot swap a look-alike in and the two lists can be compared by eye.
 */
const GSM_BASIC = new Set(
  (
    '@\u00A3$\u00A5\u00E8\u00E9\u00F9\u00EC\u00F2\u00C7\n\u00D8\u00F8\r\u00C5\u00E5' +
    '\u0394_\u03A6\u0393\u039B\u03A9\u03A0\u03A8\u03A3\u0398\u039E\u00C6\u00E6\u00DF\u00C9' +
    ' !"#\u00A4%&\'()*+,-./0123456789:;<=>?\u00A1' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    '\u00C4\u00D6\u00D1\u00DC\u00A7\u00BF' +
    'abcdefghijklmnopqrstuvwxyz' +
    '\u00E4\u00F6\u00F1\u00FC\u00E0'
  ).split('')
);

/** GSM 03.38 extension table — two slots each. */
const GSM_EXTENSION = new Set('^{}\\[~]|\u20AC'.split(''));

/** Normalises typographic characters and strips braces, as the dispatcher does. */
export function smsNormalise(text: string): string {
  let out = '';
  for (const ch of text) out += REPLACEMENTS.get(ch) ?? ch;
  // Braces are read by the backend as template placeholders; the dispatcher
  // strips them, so they cost nothing.
  return out.replace(/[{}]/g, '');
}

export interface SmsCost {
  /** Credits for ONE recipient. */
  segments: number;
  /** True when the whole message has fallen back to UCS-2. */
  unicode: boolean;
  /** Length in the units the chosen encoding counts. */
  length: number;
  /** Characters left before the next segment starts. */
  remaining: number;
}

export function smsCost(text: string): SmsCost {
  const normalised = smsNormalise(text);
  if (normalised === '') return { segments: 0, unicode: false, length: 0, remaining: 160 };

  let gsm = 0;
  let ucs = 0;
  let isGsm = true;

  for (const ch of normalised) {
    // Beyond the Basic Multilingual Plane (emoji, mostly) is a surrogate pair.
    ucs += ch.codePointAt(0)! > 0xffff ? 2 : 1;

    if (isGsm) {
      if (GSM_BASIC.has(ch)) gsm += 1;
      else if (GSM_EXTENSION.has(ch)) gsm += 2;
      else isGsm = false;
    }
  }

  if (isGsm) {
    const segments = gsm <= 160 ? 1 : Math.ceil(gsm / 153);
    const capacity = segments === 1 ? 160 : segments * 153;
    return { segments, unicode: false, length: gsm, remaining: capacity - gsm };
  }

  const segments = ucs <= 70 ? 1 : Math.ceil(ucs / 67);
  const capacity = segments === 1 ? 70 : segments * 67;
  return { segments, unicode: true, length: ucs, remaining: capacity - ucs };
}
