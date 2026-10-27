/**
 * One place that knows which network a handle belongs to.
 *
 * The bug this exists to kill: a plan built from a YouTube channel linked the
 * creator to `instagram.com/sourdoughsam`, and the benchmark rows under it were
 * stamped `platform: "instagram"` because that was the only platform the first
 * version ever saw. The data was real, the label was not, and a creator who
 * tapped the link landed on somebody else's account. Accuracy here is not
 * cosmetic — a wrong profile link is the most obviously wrong thing on the page.
 *
 * So nothing outside this file is allowed to hardcode a hostname.
 */
import type { Platform } from "./types";

/** The name a creator would use for the network. */
export function platformName(p: Platform | undefined): string {
  switch (p) {
    case "youtube":
      return "YouTube";
    case "tiktok":
      return "TikTok";
    case "instagram":
    default:
      return "Instagram";
  }
}

/** What the network calls itself in a sentence: "on YouTube", "on Instagram". */
export function platformOn(p: Platform | undefined): string {
  return `on ${platformName(p)}`;
}

/**
 * A profile URL that actually resolves.
 *
 * YouTube handles have carried an `@` since 2022 and old /c/ and /user/ paths
 * are gone for new accounts, so `@handle` is the only shape worth emitting.
 * A leading `@` is stripped first because handles arrive from the form, from a
 * cached benchmark row and from a provider response, and only some of those
 * include it.
 */
export function profileUrl(handle: string, p: Platform | undefined): string {
  const clean = handle.replace(/^@/, "").trim();
  switch (p) {
    case "youtube":
      return `https://www.youtube.com/@${clean}`;
    case "tiktok":
      return `https://www.tiktok.com/@${clean}`;
    case "instagram":
    default:
      return `https://www.instagram.com/${clean}/`;
  }
}

/**
 * Is this link already a real post URL?
 *
 * Most rows carry one from the provider. The fallback to a profile page exists
 * for rows that do not, and it must fall back to the *right* profile.
 */
export function postUrl(
  url: string | undefined,
  handle: string,
  p: Platform | undefined,
): string {
  if (url && /^https?:\/\//.test(url)) return url;
  return profileUrl(handle, p);
}

/**
 * A handle typed for one network rarely exists on another under the same name.
 *
 * Used to decide whether a YouTube result may stand in for an Instagram handle.
 * It may not: two creators can share a name, and silently merging them means the
 * plan describes a stranger's posts. The pipeline therefore keeps the platform
 * the data actually came from and says so on the page.
 */
export function sameNetwork(a: Platform | undefined, b: Platform | undefined): boolean {
  return (a ?? "instagram") === (b ?? "instagram");
}

/**
 * How to phrase the source line above a plan.
 *
 * Returning the phrase here rather than in the component keeps the wording in
 * one file, so the plan page, the ideas page and the shared card cannot drift
 * into three different claims about where the numbers came from.
 */
export function sourceNote(
  dataPlatform: Platform | undefined,
  askedPlatform?: Platform,
): string | null {
  if (!dataPlatform) return null;
  if (askedPlatform && !sameNetwork(dataPlatform, askedPlatform)) {
    return `Read from ${platformName(dataPlatform)} — the handle you typed is not the same account there, so check these are your posts.`;
  }
  return `Read from ${platformName(dataPlatform)}.`;
}
