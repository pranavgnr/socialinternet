/**
 * The three pages the Shambles launch retired.
 *
 * `/start` was replaced by the landing search. `/discover` and `/room` were
 * replaced by the niche dossier, so a link carrying `?q=` must land on that
 * room rather than the front page. The table is plain data so the redirect
 * itself and its tests cannot drift apart.
 *
 * The query is decoded by the time it reaches here. It is encoded again with
 * `encodeURIComponent` for the destination: interpolating the raw value (as a
 * `next.config.ts` `redirects()` destination does) would put spaces, `../` or
 * non-Latin text into the Location header. Anything longer than the dossier
 * can use is sent to the landing page instead of producing a huge header.
 */
export const LEGACY_SEARCH_LIMIT = 300;

type Target = (query?: string | null) => string;

export interface LegacyRoute {
  source: string;
  target: Target;
}

function nicheTarget(query?: string | null): string {
  const phrase = (query ?? "").trim();
  if (!phrase || phrase.length > LEGACY_SEARCH_LIMIT) return "/";
  return `/search/niche/${encodeURIComponent(phrase)}`;
}

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { source: "/start", target: () => "/" },
  { source: "/discover", target: nicheTarget },
  { source: "/room", target: nicheTarget },
];

/**
 * The destination for a retired path, or `null` when the path is still live.
 * Pure and dependency-free so `proxy.ts` only has to make the response.
 */
export function legacyTarget(
  pathname: string,
  query?: string | null,
): string | null {
  const route = LEGACY_ROUTES.find((r) => r.source === pathname);
  return route ? route.target(query) : null;
}
