/**
 * Turns whatever Supabase Auth threw into a sentence a member can act on.
 *
 * The raw values are not fit to show anybody. A failed request can surface as
 * `{"status":500,"statusText":"","redirected":false,"url":"https://…"}` — the
 * serialised Response, with the project URL in it — because the client puts the
 * body it could not parse into `message`. Showing that tells the user nothing,
 * looks broken, and leaks the backend address.
 *
 * Anything not recognised becomes a generic line plus the hint that matters:
 * try again, and if it keeps happening it is not something they can fix.
 */

interface Rule {
  match: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    // The common real cause when adding a number: it is already on another
    // Kobox account, so it cannot identify two people.
    match: /already (been )?registered|already in use|already exists|duplicate/i,
    message:
      'That number is already on another Kobox account. Sign in with it instead, or use a different number.',
  },
  {
    match: /rate limit|too many|only request this after|after \d+ seconds?/i,
    message: 'Too many attempts. Wait a minute and try again.',
  },
  {
    match: /expired|invalid.*(token|otp|code)|token has expired/i,
    message: 'That code has expired or is not right. Ask for a new one.',
  },
  {
    match: /invalid login credentials|invalid email or password/i,
    message: 'That email and password do not match an account.',
  },
  {
    match: /network|fetch failed|timeout|timed out/i,
    message: 'Could not reach Kobox. Check your connection and try again.',
  },
  {
    match: /not a ghana mobile|phone.*invalid|invalid.*phone/i,
    message: 'That does not look like a Ghana mobile number. Enter it like 024 123 4567.',
  },
];

/**
 * True when a message is machine noise rather than something written for a
 * person — a JSON blob, a bare status line, or a URL.
 */
function isUnreadable(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('<') ||
    /^https?:\/\//i.test(trimmed) ||
    /"status"\s*:/.test(trimmed) ||
    /^\d{3}(\s|$)/.test(trimmed)
  );
}

export function describeAuthError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as { message?: unknown } | null)?.message ?? '');

  const message = typeof raw === 'string' ? raw : '';

  for (const rule of RULES) {
    if (rule.match.test(message)) return rule.message;
  }

  // A recognisable sentence from Supabase is usually better than our fallback —
  // but only if it reads like one.
  if (!isUnreadable(message) && message.length < 160) return message;

  return fallback;
}
