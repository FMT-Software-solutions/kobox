/**
 * Ghana phone numbers.
 *
 * Kobox is a Ghana app, so there is exactly one country code and no picker. A
 * phone number is the member's identity for signing in and the address an OTP
 * is sent to, which means two things have to be true at once:
 *
 *   * ONE canonical form is stored — E.164, `+233XXXXXXXXX`. Linking a phone
 *     login to the member record a treasurer typed in depends on the two
 *     matching exactly, and `024 123 4567` vs `+233241234567` do not.
 *   * Every way a Ghanaian would write their own number is accepted. People
 *     say and type `024 123 4567`; asking them to reformat it is how you lose
 *     the member the app was built for.
 *
 * Display always goes back to the local `024 123 4567` form, because that is
 * how the number is read aloud, printed on a card and recognised.
 */

/** Ghana's country calling code, without the plus. */
export const GH_DIALLING_CODE = '233';

/** Digits after the country code: `241234567`. */
const SUBSCRIBER_LENGTH = 9;

/**
 * Mobile subscriber numbers begin 2 or 5 (dialled locally as 02X / 05X).
 * Landlines begin 3 (030 Accra, 032 Koforidua…) and cannot receive an SMS.
 */
const MOBILE_FIRST_DIGITS = ['2', '5'];

/**
 * Network by prefix, for display only.
 *
 * Deliberately NOT used for validation. The NCA allocates new ranges from time
 * to time, and a hard-coded allowlist would start rejecting perfectly real
 * numbers the day that happens — locking members out of their own money. An
 * unrecognised prefix here simply shows no network name.
 */
const NETWORKS: Record<string, string> = {
  '24': 'MTN',
  '25': 'MTN',
  '53': 'MTN',
  '54': 'MTN',
  '55': 'MTN',
  '59': 'MTN',
  '20': 'Telecel',
  '50': 'Telecel',
  '26': 'AirtelTigo',
  '27': 'AirtelTigo',
  '56': 'AirtelTigo',
  '57': 'AirtelTigo',
  '23': 'Glo',
};

export type PhoneProblem = 'empty' | 'not-ghana' | 'landline' | 'malformed';

export interface PhoneParseFailure {
  ok: false;
  problem: PhoneProblem;
  /** Ready to show under the field. */
  message: string;
}

export interface PhoneParseSuccess {
  ok: true;
  /** Canonical `+233241234567`. This is what gets stored and compared. */
  e164: string;
  /** The 9 digits after the country code. */
  subscriber: string;
}

export type PhoneParseResult = PhoneParseSuccess | PhoneParseFailure;

/**
 * Turns anything a Ghanaian might type into canonical E.164.
 *
 * Accepts `024 123 4567`, `0241234567`, `241234567`, `+233 24 123 4567`,
 * `233241234567`, `00233241234567`, and any of those with dashes, dots,
 * brackets or stray spaces.
 */
export function parseGhanaPhone(input: string): PhoneParseResult {
  const raw = (input ?? '').trim();
  if (raw.length === 0) {
    return { ok: false, problem: 'empty', message: 'Enter a phone number' };
  }

  // Keep digits only. A leading + carries no information once we know the
  // number is Ghanaian, and "00" is just the international prefix spelled out.
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith(GH_DIALLING_CODE)) {
    digits = digits.slice(GH_DIALLING_CODE.length);
    // `+233 024 123 4567` is wrong but common — people paste the country code
    // in front of the number as they normally write it. The trunk 0 is never
    // part of the international form, so drop it rather than reject them.
    if (digits.length === SUBSCRIBER_LENGTH + 1 && digits.startsWith('0')) {
      digits = digits.slice(1);
    }
  } else if (digits.startsWith('0')) {
    // Local trunk form: 0241234567.
    digits = digits.slice(1);
  } else if (digits.length > SUBSCRIBER_LENGTH) {
    // Long, and not Ghanaian — a foreign number rather than a typo.
    return {
      ok: false,
      problem: 'not-ghana',
      message: 'Kobox only supports Ghana numbers at the moment',
    };
  }

  if (digits.length !== SUBSCRIBER_LENGTH) {
    return {
      ok: false,
      problem: 'malformed',
      message: 'A Ghana number has 10 digits, like 024 123 4567',
    };
  }

  if (!MOBILE_FIRST_DIGITS.includes(digits[0]!)) {
    // Named specifically: someone entering their office landline needs to know
    // why it was refused, not just that it was.
    return {
      ok: false,
      problem: 'landline',
      message: 'That looks like a landline. Enter a mobile number so we can text you',
    };
  }

  return { ok: true, e164: `+${GH_DIALLING_CODE}${digits}`, subscriber: digits };
}

/** True when the input is a usable Ghanaian mobile number. */
export function isGhanaPhone(input: string): boolean {
  return parseGhanaPhone(input).ok;
}

/** Canonical form, or null. For callers that do not need the reason. */
export function toE164(input: string): string | null {
  const parsed = parseGhanaPhone(input);
  return parsed.ok ? parsed.e164 : null;
}

/**
 * Local reading form: `024 123 4567`.
 *
 * Falls back to the input unchanged rather than throwing — this is used in
 * lists, and a legacy row that predates normalisation should still render.
 */
export function formatGhanaPhone(value: string): string {
  const parsed = parseGhanaPhone(value);
  if (!parsed.ok) return value;

  const s = parsed.subscriber;
  return `0${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5)}`;
}

/**
 * Partly hidden, for the "you signed in with this last time" hint on the
 * launch screen: `024 ••• 4567`.
 *
 * The last four stay visible so the owner recognises their own number; the
 * middle is hidden so a lost phone does not display it in full to a stranger.
 */
export function maskGhanaPhone(value: string): string {
  const parsed = parseGhanaPhone(value);
  if (!parsed.ok) return value;

  const s = parsed.subscriber;
  return `0${s.slice(0, 2)} ••• ${s.slice(5)}`;
}

/** "MTN", "Telecel"… or null when the prefix is not one we know. */
export function ghanaNetwork(value: string): string | null {
  const parsed = parseGhanaPhone(value);
  if (!parsed.ok) return null;

  return NETWORKS[parsed.subscriber.slice(0, 2)] ?? null;
}
