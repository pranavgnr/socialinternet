/**
 * One canonical Instagram handle.
 *
 * Creators type the same account every way: `@Name`, `name`, a pasted profile
 * URL with a tracking query, spaces around it. If those are kept apart they
 * become different keys in the plan cache, the vendor ledger and the account's
 * own directory — so the same creator is read twice and charged twice.
 *
 * A handle is only letters, numbers, dots and underscores, at most 30
 * characters, and it cannot start or end with a dot or contain two in a row —
 * Instagram itself rejects those. Anything else is not a handle, and `null`
 * says so instead of passing a guess to a vendor.
 */
const SHAPE = /^[a-z0-9._]{1,30}$/;

/**
 * Instagram paths that are content or navigation, never a profile. A pasted
 * post URL must not become the handle "p" and spend a credit reading an
 * account that does not exist.
 *
 * This list is checked only for URL-shaped input. A bare word such as
 * "explore" is a legal Instagram handle, so typing it without a URL must keep
 * working; the same word after instagram.com/ is the route.
 */
const CONTENT_ROUTES = new Set([
  "p",
  "post",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "about",
  "legal",
  "developer",
  "web",
  "challenge",
  "directory",
]);

/** `https://…`, `http://…` or a bare `instagram.com/…`, with optional www. */
const INSTAGRAM_URL = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i;

/**
 * Is this input shaped like a profile — an `@handle` or an `instagram.com`
 * profile URL — rather than a niche phrase?
 *
 * The search box has one input and two jobs: "telugu music covers" is a niche,
 * "@priya" is an account. Only the two profile shapes switch to a competitor
 * read; a bare word such as "cooking" stays a niche phrase exactly as it always
 * was, even though it is a legal Instagram handle.
 *
 * The URL uses the same parser as `normalizeHandle`, so a content URL
 * (`instagram.com/p/…`) is still not a profile and keeps the niche path.
 */
export function looksLikeHandle(input: string): boolean {
  if (typeof input !== "string") return false;
  const value = input.trim();
  if (!value) return false;
  if (!value.startsWith("@") && !INSTAGRAM_URL.test(value)) return false;
  return normalizeHandle(value) !== null;
}

export function normalizeHandle(input: string): string | null {
  if (typeof input !== "string") return null;

  let value = input.trim();
  if (!value) return null;

  const wasUrl = INSTAGRAM_URL.test(value);
  if (wasUrl) value = value.replace(INSTAGRAM_URL, "");

  value = value.replace(/^@/, "").toLowerCase();
  const segment = value.split(/[/?#]/)[0] ?? "";

  if (!segment) return null;
  if (wasUrl && CONTENT_ROUTES.has(segment)) return null;
  if (!SHAPE.test(segment)) return null;
  if (segment.startsWith(".") || segment.endsWith(".")) return null;
  if (segment.includes("..")) return null;

  return segment;
}
