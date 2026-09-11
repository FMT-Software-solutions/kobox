/**
 * Money handling for Kobox.
 *
 * RULE: money is ALWAYS stored, passed around and summed as an integer number of
 * minor units (pesewas for GHS, cents for USD). Never floats — `0.1 + 0.2` is not
 * `0.3`, and a contribution ledger that drifts by a pesewa is a ledger nobody trusts.
 *
 * Only convert to a decimal string at the moment of display, via `formatMoney`.
 */

/** An integer amount in minor units (e.g. 1250 === GHS 12.50). */
export type Minor = number;

export type CurrencyCode = 'GHS' | 'NGN' | 'USD' | 'EUR' | 'GBP' | 'KES' | 'ZAR';

type CurrencyMeta = { symbol: string; decimals: number };

const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  GHS: { symbol: '₵', decimals: 2 },
  NGN: { symbol: '₦', decimals: 2 },
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  KES: { symbol: 'KSh', decimals: 2 },
  ZAR: { symbol: 'R', decimals: 2 },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'GHS';

export function currencyMeta(code: CurrencyCode): CurrencyMeta {
  return CURRENCIES[code];
}

/**
 * Parse user input ("12.50", "12,50", "1,250.75", "₵12") into minor units.
 * Returns null when the input is not a valid amount, so callers can show a
 * validation message rather than silently recording a wrong figure.
 */
export function parseMoney(input: string, code: CurrencyCode = DEFAULT_CURRENCY): Minor | null {
  const { decimals } = CURRENCIES[code];

  // Separator rules are FIXED, never inferred:
  //   '.' is always the decimal point
  //   ',' is always thousands grouping and is discarded
  //
  // These match what formatMoney emits and the convention used in Ghana, so
  // parse(format(x)) === x always holds. An earlier version tried to guess from
  // digit grouping and read "12.999" as 12,999 — a 1000x error on a real amount.
  // Guessing is not acceptable in a ledger; a fixed rule that is occasionally
  // strict beats a clever one that is occasionally catastrophic.
  const cleaned = input.trim().replace(/[^\d.,-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;

  const negative = cleaned.startsWith('-');
  const body = (negative ? cleaned.slice(1) : cleaned).replace(/,/g, '');

  // At most one decimal point, digits either side.
  if (!/^\d*(\.\d*)?$/.test(body)) return null;

  const [wholeRaw = '', fractionRaw = ''] = body.split('.');
  if (wholeRaw === '' && fractionRaw === '') return null;

  // Extra precision the currency cannot hold is truncated, not rounded: a member
  // is never billed more than the figure they were shown.
  const fraction = fractionRaw.padEnd(decimals, '0').slice(0, decimals);
  const value = Number(`${wholeRaw || '0'}${fraction}`);
  if (!Number.isSafeInteger(value)) return null;

  return negative ? -value : value;
}

/** Format minor units for display, e.g. `1250` → `"₵12.50"`. */
export function formatMoney(
  amount: Minor,
  code: CurrencyCode = DEFAULT_CURRENCY,
  options: { showSymbol?: boolean; showCode?: boolean } = {}
): string {
  const { showSymbol = true, showCode = false } = options;
  const { symbol, decimals } = CURRENCIES[code];

  const negative = amount < 0;
  const abs = Math.abs(amount);
  const divisor = 10 ** decimals;

  const whole = Math.trunc(abs / divisor);
  const fraction = abs % divisor;

  const groupedWhole = whole.toLocaleString('en-US');
  const body =
    decimals > 0 ? `${groupedWhole}.${String(fraction).padStart(decimals, '0')}` : groupedWhole;

  const prefix = `${negative ? '-' : ''}${showSymbol ? symbol : ''}`;
  return showCode ? `${prefix}${body} ${code}` : `${prefix}${body}`;
}

/** Sum minor amounts safely. */
export function sumMoney(amounts: readonly Minor[]): Minor {
  return amounts.reduce<Minor>((total, amount) => total + amount, 0);
}

/**
 * Split an amount into `parts` as evenly as possible, distributing the
 * remainder one minor unit at a time so the parts always sum back to `amount`.
 * Used for splitting a group levy across members.
 */
export function splitMoney(amount: Minor, parts: number): Minor[] {
  if (parts <= 0) return [];
  const base = Math.trunc(amount / parts);
  let remainder = amount - base * parts;
  const step = remainder >= 0 ? 1 : -1;

  return Array.from({ length: parts }, () => {
    if (remainder !== 0) {
      remainder -= step;
      return base + step;
    }
    return base;
  });
}

/** Percentage of `paid` against `expected`, clamped to 0–100 and safe when expected is 0. */
export function completionPercent(paid: Minor, expected: Minor): number {
  if (expected <= 0) return paid > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((paid / expected) * 100)));
}
