/**
 * Turns whatever the data layer threw into a sentence a creator can act on.
 * The real message goes to the server log, never to the page.
 */
export function friendly(err: unknown, fallback: string): string {
  const raw = ((err as Error)?.message ?? "").trim();
  console.error("[creators101]", raw || err);

  if (/handle is required|invalid handle|bad handle/i.test(raw)) {
    return "That handle doesn't look right. Type it the way it appears on Instagram, without spaces.";
  }
  if (/not enough credits|balance|quota|402/i.test(raw)) {
    return "We are at capacity right now. Try again later today.";
  }
  if (/does not serve this data publicly|audience controls|limited account|private/i.test(raw)) {
    return "That account keeps its reels private, so there is nothing public to read. Try a handle that posts publicly.";
  }
  if (/RESOURCE_NOT_FOUND|not found on the platform|no such (user|account)/i.test(raw)) {
    return "We could not find that handle on Instagram. Check the spelling and try again — it should be just the username, not the full link.";
  }
  if (/private|not found|unknown|no reels|404|does not exist/i.test(raw)) {
    return "We could not read that account. Check the spelling — private accounts have nothing public to read.";
  }
  if (/timeout|aborted|network|fetch failed|ECONN|ENOTFOUND|socket/i.test(raw)) {
    return "The data source did not answer in time. Give it a minute and try again.";
  }
  if (/rate|too many|429/i.test(raw)) {
    return "That is a lot of requests. Try again in a few minutes.";
  }
  return fallback;
}
