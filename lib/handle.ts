/**
 * One canonical Instagram handle.
 *
 * Creators type the same account every way: `@Name`, `name`, a pasted profile
 * URL with a tracking query, spaces around it. If those are kept apart they
 * become different keys in the plan cache, the vendor ledger and the account's
 * own directory — so the same creator is read twice and charged twice.
 *
 * A handle is only letters, numbers, dots and underscores, at most 30
 * characters. Anything else is not a handle, and `null` says so instead of
 * passing a guess to a vendor.
 */
const SHAPE = /^[a-z0-9._]{1,30}$/;

export function normalizeHandle(input: string): string | null {
  if (typeof input !== "string") return null;

  let value = input.trim();
  if (!value) return null;

  // A pasted profile URL: drop the scheme, host and everything after the
  // handle (trailing slash, query string, fragments).
  value = value.replace(
    /^https?:\/\/(?:www\.)?instagram\.com\//i,
    "",
  );
  value = value.replace(/^@/, "");
  value = (value.split(/[/?#]/)[0] ?? "").toLowerCase();

  return SHAPE.test(value) ? value : null;
}
