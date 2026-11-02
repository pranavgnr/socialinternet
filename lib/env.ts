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
 * shorter than a day. The result is capped at one year: a typo like `1e9` must
 * not turn a cache into "never expires again".
 */
export const MAX_HOURS = 24 * 365;

export function hoursFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, MAX_HOURS);
}

/**
 * A whole number from `name`, or `fallback`.
 *
 * The integer twin of `hoursFromEnv`: empty, non-numeric, zero and negative
 * values read as unset, and a fraction is floored. A cap read from the
 * environment is a budget, so `1e9` must not become "read a billion profiles";
 * callers pass their own `max` for the ceiling that fits the job.
 */
export function intFromEnv(
  name: string,
  fallback: number,
  max = 1_000,
): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), Math.max(1, Math.floor(max)));
}

/**
 * Settings whose values are credentials. Used to scrub vendor error text before
 * it is logged, stored or posted to an operator webhook.
 */
const SECRET_ENV = [
  "APIFY_TOKEN",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "HIKERAPI_KEY",
  "CRON_SECRET",
];

/**
 * A vendor error can quote the request URL, and those URLs carry tokens. Keep
 * the message, remove the credential.
 *
 * Lives here rather than in `lib/canary.ts` so the router can redact what it
 * logs without importing the canary (which imports the router). `canary.ts`
 * re-exports it, so existing callers are unchanged.
 */
export function redactSecrets(message: string): string {
  let out = message;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  out = out.replace(
    /([?&](?:token|key|api_key|apikey|access_token)=)[^&\s]+/gi,
    "$1[redacted]",
  );
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  return out.slice(0, 500);
}
