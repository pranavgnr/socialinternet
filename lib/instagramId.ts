/**
 * Instagram media ids, recovered without trusting a parsed number.
 *
 * Instagram sends a media's numeric pk in two places:
 *
 *   - as a JSON number (`pk`, `strong_id__`): above 2^53 this is already
 *     rounded by `JSON.parse`, so it can never identify the post;
 *   - as the shortcode (`code`, e.g. `DQBw9CVk7C4`): a base-64 encoding of the
 *     same pk, exact by construction.
 *
 * The comments endpoint wants `<pk>_<ownerPk>`, so a post read that has lost
 * `media.id` still has a correct way back: decode the shortcode.
 */

/**
 * Instagram's shortcode alphabet. Index in this string is the base-64 digit.
 * This is the URL-safe alphabet, not the RFC 4648 one.
 */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The exact decimal pk behind an Instagram shortcode.
 *
 * Big-endian base 64: `value = Σ index(char) * 64^position`. BigInt is
 * deliberate — the result is routinely above `Number.MAX_SAFE_INTEGER`.
 *
 * Accepts a pasted shortcode with a leading or trailing slash. Throws on an
 * empty string or a character outside the alphabet, rather than returning a
 * plausible wrong id that would buy a 422.
 */
export function pkFromShortcode(code: string): string {
  const clean = code.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) throw new Error("empty Instagram shortcode");
  let value = BigInt(0);
  for (const char of clean) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new Error(`invalid character in Instagram shortcode: ${char}`);
    }
    value = value * BigInt(64) + BigInt(digit);
  }
  return value.toString();
}
