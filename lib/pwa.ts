/**
 * Progressive Web App rules.
 *
 * The service worker has to be plain JavaScript served from `public/`, so it
 * cannot import this module. `public/sw.js` duplicates the same small rule set
 * and `scripts/test-pwa.ts` evaluates both against one table of URLs, which is
 * what keeps them honest.
 *
 * Safety does not come from inspecting cookies (a worker cannot read them). It
 * comes from a public allowlist plus network-only navigations: only build
 * assets, icons, fonts and the static offline shell may enter the cache. Every
 * other request, including `/api/` and every private page, is left to the
 * browser and never persisted.
 */

export interface CacheRequestLike {
  method: string;
  url: string;
}

/** Prefixes whose GET responses are safe, public build output. */
const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"] as const;

/** The only page shell allowed in the cache: the offline fallback itself. */
const CACHEABLE_PATHS = new Set(["/offline", "/offline/", "/offline.html"]);

const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;

/**
 * True only for GETs of public assets. The worker also checks same-origin and
 * the response headers before storing anything; this helper decides the URL.
 */
export function shouldCache(request: CacheRequestLike): boolean {
  if (request.method.toUpperCase() !== "GET") return false;

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

/**
 * How many entries the static cache may hold. Hashed chunks accumulate on every
 * deploy; this cap keeps one cache from growing forever.
 */
export const CACHE_MAX_ENTRIES = 120;

/** Shell entries that must survive a trim. */
const PROTECTED_CACHE_PATHS = new Set([
  "/offline",
  "/offline/",
  "/offline.html",
]);

function cachePathname(url: string): string | null {
  try {
    return new URL(url, "https://shambles.local").pathname;
  } catch {
    return null;
  }
}

/**
 * Oldest-first eviction list. `urls` is in `cache.keys()` insertion order;
 * returns the URLs to delete so the cache is at most `max` entries. The offline
 * shell is never returned, even when it is the oldest entry.
 */
export function cacheEntriesToTrim(
  urls: string[],
  max: number = CACHE_MAX_ENTRIES,
): string[] {
  if (urls.length <= max) return [];
  const removable = urls.filter((url) => {
    const pathname = cachePathname(url);
    return pathname !== null && !PROTECTED_CACHE_PATHS.has(pathname);
  });
  const excess = urls.length - max;
  return removable.slice(0, Math.min(excess, removable.length));
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
 * the page. iPadOS in desktop-UA mode reports itself as a Macintosh, so touch
 * capability is checked as well as the classic iOS tokens.
 */
export function isInstallable(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  const ua = userAgent || "";
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  if (/android/i.test(ua)) return true;
  if (/macintosh/i.test(ua) && maxTouchPoints > 1) return true;
  if (/mobile/i.test(ua) && !/windows nt|macintosh|cros/i.test(ua)) return true;
  return false;
}

/**
 * The iOS "Share → Add to Home Screen" hint belongs to Safari only.
 *
 * CriOS (real Chrome on iOS), FxiOS, EdgiOS, Opera and every common in-app
 * browser use WebKit but cannot run Safari's add-to-home flow, so they get no
 * hint. iPadOS in desktop-UA mode looks like a Macintosh; `maxTouchPoints > 1`
 * identifies it as an iPad.
 */
export function isIosSafari(
  userAgent: string,
  maxTouchPoints = 0,
): boolean {
  const ua = userAgent || "";
  const ios = /iphone|ipad|ipod/i.test(ua);
  const ipadDesktop = /macintosh/i.test(ua) && maxTouchPoints > 1;
  if (!ios && !ipadDesktop) return false;
  if (
    /(instagram|fban|fbav|line\/|snapchat|gsa\/|crios|fxios|edgios|opios|mercury)/i.test(
      ua,
    )
  ) {
    return false;
  }
  return /safari/i.test(ua);
}

export const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export interface VisitRecord {
  /** Local calendar day, `YYYY-M-D`. */
  day: string;
  count: number;
}

/**
 * Count one visit per calendar day. The first visit is 1, so a visitor sees the
 * install bar on the second distinct day (or earlier after opening a profile),
 * and a reload on the same day does not count twice.
 */
export function nextVisit(
  previous: VisitRecord | null,
  todayKey: string,
): VisitRecord {
  if (!previous || !previous.day) return { day: todayKey, count: 1 };
  if (previous.day === todayKey) return previous;
  return { day: todayKey, count: previous.count + 1 };
}

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
 * Show on the second distinct visit or after a profile was opened, never in
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
