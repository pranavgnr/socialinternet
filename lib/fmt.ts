/**
 * Numbers written the way a creator says them out loud.
 *
 * The bug this exists to kill: a plan told a creator their best post "did
 * 3999.8x your usual views". The arithmetic was right — 45.1M against an 11k
 * median — but the *number* was absurd. Nobody says "three thousand nine
 * hundred and ninety-nine point eight times". Four significant figures on a
 * ratio derived from two medians of a dozen posts each claims a precision the
 * data does not have, and it makes the whole page read as machine output.
 *
 * The rule here is significant figures, not decimal places: the bigger the
 * number, the less of it is real. 1.4x, 8x, 240x, 4,000x. Past 1,000 the only
 * honest thing to say is roughly how many thousands.
 */

/** Compact view counts: 999, 1.2k, 45.1M. One decimal only below 10M. */
export function compact(n: number): string {
  const v = Math.abs(n);
  if (!Number.isFinite(n)) return "0";
  if (v >= 1_000_000_000) return `${trim(n / 1_000_000_000, v >= 10_000_000_000 ? 0 : 1)}B`;
  if (v >= 1_000_000) return `${trim(n / 1_000_000, v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${Math.round(n / 1_000)}k`;
  if (v >= 1_000) return `${trim(n / 1_000, 1)}k`;
  return String(Math.round(n));
}

function trim(n: number, places: number): string {
  return n.toFixed(places).replace(/\.0$/, "");
}

/**
 * A multiple, rounded to the precision the measurement actually supports.
 *
 *   1.04  -> "1.04x"   (just above normal: say so precisely, it is a near-miss)
 *   1.35  -> "1.4x"
 *   8.2   -> "8x"
 *   24.7  -> "25x"
 *   240   -> "240x"
 *   3999.8-> "4,000x"
 *   12000 -> "12,000x"
 *
 * Below 10 the first decimal carries real information, so it stays. Above 10 a
 * decimal is noise, and above 100 the tens digit is noise too.
 */
export function times(n: number): string {
  if (!Number.isFinite(n)) return "0x";
  const v = Math.abs(n);
  if (v < 1.1) return `${v.toFixed(2).replace(/0$/, "").replace(/\.$/, "")}x`;
  if (v < 10) return `${v.toFixed(1).replace(/\.0$/, "")}x`;
  if (v < 100) return `${Math.round(v)}x`;
  // Two significant figures above 100: 240x, 1,900x, 12,000x.
  const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  const rounded = Math.round(v / mag) * mag;
  return `${rounded.toLocaleString("en-US")}x`;
}

/**
 * A multiple as words, for sentences where "4,000x" is still too loud.
 *
 * Above 1,000 a ratio is really saying "this one was a fluke, not a pattern",
 * so the sentence changes shape rather than the number growing.
 */
export function timesWord(n: number): string {
  if (!Number.isFinite(n)) return "far more than usual";
  if (n >= 1_000) return "over 1,000x";
  return times(n);
}

/** A share as a whole-number percent, with the small ones not rounded to 0%. */
export function pct(fraction: number): string {
  const p = fraction * 100;
  if (!Number.isFinite(p)) return "0%";
  if (p > 0 && p < 1) return "under 1%";
  return `${Math.round(p)}%`;
}

/** Days, said the way a person would. */
export function days(n: number): string {
  if (!Number.isFinite(n)) return "unknown";
  if (n < 1) return "same day";
  if (n < 2) return "1 day";
  if (n < 14) return `${Math.round(n)} days`;
  if (n < 60) return `${Math.round(n / 7)} weeks`;
  return `${Math.round(n / 30)} months`;
}
