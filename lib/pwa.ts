/**
 * Progressive Web App rules.
 *
 * The service worker has to be plain JavaScript served from `public/`, so it
 * cannot import this module. `public/sw.js` duplicates the same small rule set
 * and `scripts/test-pwa.ts` evaluates both against one table of URLs, which is
 * what keeps them honest.
 *
 * The cache is deliberately tiny. Shambles reads private accounts, spends
 * gems and moves credits, so nothing authenticated and nothing under `/api/`
 * is ever stored. Only build assets, icons, fonts and the `/offline` shell
 * may enter the cache.
 */

export interface CacheRequestLike {
  method: string;
  url: string;
  /** True when the worker cannot prove the request is anonymous. */
  hasCredentials: boolean;
}

/** Prefixes whose GET responses are safe, public build output. */
const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"] as const;

/** The only page shell allowed in the cache: the offline fallback itself. */
const CACHEABLE_PATHS = new Set(["/offline", "/offline/"]);

const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;

/**
 * True only for anonymous GETs of public assets.
 *
 * A worker cannot read the `Cookie` header, so callers pass `hasCredentials`
 * when they know a request is authenticated (the register/install code and the
 * sync test do). Everything else that is not an explicit public asset is left
 * alone: the browser talks to the network, and no private HTML is persisted.
 */
export function shouldCache(request: CacheRequestLike): boolean {
  if (request.method.toUpperCase() !== "GET") return false;
  if (request.hasCredentials) return false;

  let pathname: string;
  try {
    // The base only exists so relative URLs in tests resolve predictably.
    pathname = new URL(request.url, "https://shambles.local").pathname;
  } catch {
    return false;
  }

  if (CACHEABLE_PATHS.has(pathname)) return true;
  if (CACHEABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  return FONT_FILE.test(pathname);
}

/** `v1` -> `shambles-static-v1`. Bump the version to invalidate a deploy. */
export function cacheNameFor(version: string): string {
  const clean = version.trim().replace(/^shambles-static-/, "");
  return `shambles-static-${clean || "v1"}`;
}

/** Any cache this app owns, including ones from older deployments. */
export function isAppCache(name: string): boolean {
  return name.startsWith("shambles-");
}

/**
 * Whether this device should be offered "Add to Home Screen".
 *
 * Desktop Chrome can install too, but the founder requirement is a phone-first
 * bar: desktop visitors get the browser's own affordance instead of a bar over
 * the page. iPadOS reports itself as a Mac, so the `Mobile/` token is checked
 * as well as the classic iOS tokens.
 */
export function isInstallable(userAgent: string): boolean {
  const ua = userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  if (/android/i.test(ua)) return true;
  if (/mobile/i.test(ua) && !/windows nt|macintosh|cros/i.test(ua)) return true;
  return false;
}

/** iOS browsers do not fire `beforeinstallprompt`; Safari needs the hint. */
export function isIosSafari(userAgent: string): boolean {
  const ua = userAgent || "";
  const ios = /iphone|ipad|ipod/i.test(ua);
  if (!ios) return false;
  // CriOS/FxiOS/EdgiOS/OPiOS still use WebKit but are not Safari's share sheet
  // wording, so keep the hint to Safari proper.
  return !/(crios|fxios|edgios|opios|mercury)/i.test(ua);
}

export const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export interface InstallPromptState {
  /** Completed visits, including this one. */
  visits: number;
  /** The visitor has opened at least one profile. */
  profileOpened: boolean;
  /** Epoch ms of an explicit dismissal, or null. */
  dismissedAt: number | null;
  now: number;
  standalone: boolean;
  mobile: boolean;
}

/**
 * Show after the second visit or after a profile was opened, never in
 * standalone mode, and stay quiet for 30 days after a dismissal.
 */
export function shouldShowInstallPrompt(state: InstallPromptState): boolean {
  if (state.standalone || !state.mobile) return false;
  if (
    state.dismissedAt !== null &&
    state.now - state.dismissedAt < INSTALL_DISMISS_MS
  ) {
    return false;
  }
  return state.visits >= 2 || state.profileOpened;
}
