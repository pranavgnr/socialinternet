/*
 * Shambles service worker.
 *
 * Plain JavaScript because a worker is served from `public/` and cannot import
 * the TypeScript helpers. `lib/pwa.ts` is the source of truth for the cache
 * rules; `scripts/test-pwa.ts` evaluates the copies below in a VM against the
 * same URL tables, so they cannot drift silently.
 *
 * Safety does not come from inspecting cookies — a worker cannot read them. It
 * comes from the public allowlist plus network-only navigations:
 *   1. Only GET, same-origin, allow-listed URLs.
 *   2. Never `/api/`, never a private page; navigation responses are never
 *      stored.
 *   3. Never store a response with `Set-Cookie`, `Cache-Control: no-store` or
 *      `private`.
 *   4. Keep the static cache bounded: oldest entries are evicted first, and
 *      the offline shell is never evicted.
 */

const CACHE_PREFIX = "shambles-";
const CACHE_VERSION = "v1";
const CACHE_NAME = "shambles-static-" + CACHE_VERSION;
const CACHE_MAX_ENTRIES = 120;

const OFFLINE_URL = "/offline";
// A static, dependency-free shell. The Next route at /offline is dynamic (it
// carries the visitor's header), so caching it would store personal data.
// This file is public by construction and is stored under the /offline key.
const OFFLINE_SHELL_URL = "/offline.html";

const CACHEABLE_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];
const CACHEABLE_PATHS = ["/offline", "/offline/", "/offline.html"];
const PROTECTED_CACHE_PATHS = ["/offline", "/offline/", "/offline.html"];
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;

function shouldCache(request) {
  if (String(request.method).toUpperCase() !== "GET") return false;

  let pathname;
  try {
    pathname = new URL(request.url, "https://shambles.local").pathname;
  } catch (error) {
    return false;
  }

  if (CACHEABLE_PATHS.indexOf(pathname) !== -1) return true;
  for (const prefix of CACHEABLE_PREFIXES) {
    if (pathname.indexOf(prefix) === 0) return true;
  }
  return FONT_FILE.test(pathname);
}

/** Same-origin + method + allow-list: the runtime cache decision. */
function isCacheableRequest(request, origin) {
  if (request.method !== "GET") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return false;
  }
  if (url.origin !== origin) return false;
  return shouldCache({ method: request.method, url: request.url });
}

/** Oldest-first eviction list; protected offline shell entries are skipped. */
function cacheEntriesToTrim(urls, max) {
  const limit = max || CACHE_MAX_ENTRIES;
  if (urls.length <= limit) return [];
  const removable = urls.filter((url) => {
    let pathname;
    try {
      pathname = new URL(url, "https://shambles.local").pathname;
    } catch (error) {
      return false;
    }
    return PROTECTED_CACHE_PATHS.indexOf(pathname) === -1;
  });
  const excess = urls.length - limit;
  return removable.slice(0, Math.min(excess, removable.length));
}

/** `cache.keys()` is insertion order, so this evicts the oldest entries. */
async function trimCache(cache, max) {
  const requests = await cache.keys();
  const urls = requests.map((request) => request.url);
  const stale = cacheEntriesToTrim(urls, max);
  let deleted = 0;
  for (const url of stale) {
    const request = requests.find((entry) => entry.url === url);
    if (request && (await cache.delete(request))) deleted += 1;
  }
  return deleted;
}

function isCacheableResponse(response) {
  if (!response || !response.ok || response.status !== 200) return false;
  if (response.type !== "basic" && response.type !== "default") return false;

  const cacheControl = (response.headers.get("cache-control") || "").toLowerCase();
  if (cacheControl.indexOf("no-store") !== -1) return false;
  if (cacheControl.indexOf("private") !== -1) return false;
  // A Set-Cookie response is user-specific by definition. Browsers hide this
  // header from worker code, but keep the check for environments that expose it.
  if (response.headers.get("set-cookie")) return false;

  return true;
}

async function cacheOfflineShell() {
  try {
    // `credentials: omit` makes the anonymous shell explicit; the static file
    // cannot carry a viewer's header or cookies.
    const response = await fetch(
      new Request(OFFLINE_SHELL_URL, { cache: "reload", credentials: "omit" }),
    );
    if (!isCacheableResponse(response)) return;
    const cache = await caches.open(CACHE_NAME);
    await cache.put(OFFLINE_URL, response.clone());
    await cache.put(OFFLINE_SHELL_URL, response.clone());
    await trimCache(cache);
  } catch (error) {
    // Installing without a shell is still better than never installing; the
    // next successful visit fills it in.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await cacheOfflineShell();
      // Strategy: take over as soon as the new worker is installed. A fresh
      // navigation then uses the new build; nothing reloads the current page
      // and no waiting/message hand-off is needed.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      const cache = await caches.open(CACHE_NAME);
      await trimCache(cache);
      await self.clients.claim();
    })(),
  );
});

async function cachedOffline(request) {
  if (request) {
    const hit = await caches.match(request);
    if (hit) return hit;
  }
  const cache = await caches.open(CACHE_NAME);
  return (
    (await cache.match(OFFLINE_URL)) ||
    (await cache.match(OFFLINE_URL + "/")) ||
    (await cache.match(OFFLINE_SHELL_URL)) ||
    null
  );
}

async function networkFirstNavigation(event) {
  try {
    // A server-rendered profile, chat or root document can contain a viewer's
    // own data, so no navigation response is stored. The offline shell is
    // precached from the public static file during install.
    return await fetch(event.request);
  } catch (error) {
    const offline = await cachedOffline(event.request);
    if (offline) return offline;
    return new Response(
      "<!doctype html><html><body style=\"background:#09090C;color:#FAFAFA;font:16px system-ui;padding:24px\">" +
        "<h1>You are offline</h1><p>Shambles needs a connection for anything live. " +
        "<a style=\"color:#CCFF00\" href=\"/\">Try again</a>.</p></body></html>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function cacheAssetUpdate(request) {
  try {
    const response = await fetch(request);
    if (!isCacheableResponse(response)) return response;
    const copy = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, copy);
    await trimCache(cache);
    return response;
  } catch (error) {
    return null;
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);

  if (cached) {
    // Refresh in the background; the visitor gets the fast copy now.
    event.waitUntil(cacheAssetUpdate(event.request).catch(() => undefined));
    return cached;
  }

  const response = await cacheAssetUpdate(event.request);
  if (response) return response;
  return new Response("", { status: 504, statusText: "Gateway Timeout" });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (!isCacheableRequest(request, self.location.origin)) return;
  event.respondWith(staleWhileRevalidate(event));
});
