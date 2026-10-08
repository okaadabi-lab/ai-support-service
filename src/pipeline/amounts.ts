import { normalizeText } from '../retrieval/tokenizer.js';

const MULTIPLIERS: Record<string, number> = {
  juta: 1_000_000,
  jt: 1_000_000,
  million: 1_000_000,
  mio: 1_000_000,
  ribu: 1_000,
  rb: 1_000,
  k: 1_000,
  thousand: 1_000,
};

const MONEY =
  /(?:\b(rp|idr)\.?\s*|(\$)\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?)\s*(juta|jt|million|mio|ribu|rb|thousand|k)?\b/g;
const PERCENT = /(\d+(?:[.,]\d+)?)\s*(?:%|persen\b|percent\b)/g;

/** Below this, a bare number with separators is more likely a count or a date than a price. */
const BARE_AMOUNT_MIN = 10_000;

/**
 * Extracts money amounts and percentages as canonical keys ("idr:4500000", "pct:30") so the
 * same value written as "Rp 4.500.000", "Rp4,5 juta" or "4.5jt" compares equal.
 *
 * A number counts as money when it has a currency prefix or a magnitude word, or when it uses
 * thousands separators and is at least 10,000. Plain small numbers (days, hours, guests) are
 * not checked: they are out of scope for this guardrail.
 */
export function extractAmounts(text: string): Set<string> {
  const normalized = normalizeText(text);
  const keys = new Set<string>();

  for (const match of normalized.matchAll(MONEY)) {
    const [, rupiah, dollar, digits, multiplierWord] = match;
    if (digits === undefined) {
      continue;
    }
    const hasGrouping = /^\d{1,3}(?:[.,]\d{3})+/.test(digits);
    const base = parseLocalizedNumber(digits);
    const value = Math.round(base * (multiplierWord ? (MULTIPLIERS[multiplierWord] ?? 1) : 1));
    const isMoney =
      rupiah !== undefined ||
      dollar !== undefined ||
      multiplierWord !== undefined ||
      (hasGrouping && value >= BARE_AMOUNT_MIN);
    if (isMoney) {
      keys.add(`${dollar ? 'usd' : 'idr'}:${value}`);
    }
  }

  for (const match of normalized.matchAll(PERCENT)) {
    if (match[1] !== undefined) {
      keys.add(`pct:${parseLocalizedNumber(match[1])}`);
    }
  }
  return keys;
}

/**
 * Indonesian writes 4.500.000,50 and English 4,500,000.50. A separator followed by exactly
 * three digits (repeated) is treated as a thousands separator; otherwise it is a decimal point.
 */
export function parseLocalizedNumber(digits: string): number {
  const grouped = /^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/.exec(digits);
  if (grouped?.[1] !== undefined) {
    const integer = Number(grouped[1].replace(/[.,]/g, ''));
    const fraction = grouped[2] ? Number(`0.${grouped[2]}`) : 0;
    return integer + fraction;
  }
  return Number(digits.replace(',', '.'));
}
