/**
 * Small env readers shared by the data layer.
 *
 * Numeric settings (cache lifetimes especially) are easy to get wrong in a
 * `.env`: a blank value, a stray word, `0` or a negative number should not turn
 * into "reuse this cache forever" or "expire everything instantly". They fall
 * back to the documented default instead.
 */

/**
 * A positive number of hours from `name`, or `fallback`.
 *
 * Empty, non-numeric, zero and negative values all read as unset. Decimals are
 * allowed (`1.5` is ninety minutes), because a preview session may genuinely be
 * shorter than a day.
 */
export function hoursFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
