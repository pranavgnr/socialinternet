// PWA rules, manifest, icons and worker-cache tests. No network and no browser
// required.
//   npm run test:file -- test-pwa
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import manifest from "../app/manifest";
import {
  CACHE_MAX_ENTRIES,
  cacheEntriesToTrim,
  cacheNameFor,
  isAppCache,
  isInstallable,
  isIosSafari,
  nextVisit,
  shouldCache,
  shouldShowInstallPrompt,
  type CacheRequestLike,
} from "../lib/pwa";

const root = process.cwd();

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const IOS_FIREFOX =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15";
const IPAD_DESKTOP_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DESKTOP_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function pngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  const signature = bytes.subarray(0, 8).toString("hex");
  assert.equal(signature, "89504e470d0a1a0a", `${file} is not a PNG`);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function headers(values: Record<string, string> = {}) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function workerSandbox(): Record<string, any> {
  const source = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  const sandbox: Record<string, any> = {
    URL,
    console,
    self: {
      addEventListener() {},
      skipWaiting() {},
      clients: { claim() {} },
      location: { origin: "https://shambles.test" },
      registration: {},
    },
    caches: {},
    fetch: async () => {
      throw new Error("not used");
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "public/sw.js" });
  return sandbox;
}

/**
 * A Cache-like object whose `keys()` preserves insertion order, exactly as the
 * real Cache API does.
 */
function fakeCache(urls: string[]) {
  const entries = urls.map((url, index) => ({ url, request: { url, index } }));
  return {
    entries,
    async keys() {
      return entries.map((entry) => entry.request);
    },
    async delete(request: { url: string; index: number }) {
      const index = entries.findIndex((entry) => entry.request === request);
      if (index === -1) return false;
      entries.splice(index, 1);
      return true;
    },
    size() {
      return entries.length;
    },
    has(pathname: string) {
      return entries.some(
        (entry) => new URL(entry.url, "https://shambles.test").pathname === pathname,
      );
    },
  };
}

test("shouldCache refuses writes and private routes", () => {
  const refused: CacheRequestLike[] = [
    { method: "POST", url: "/_next/static/chunk.js" },
    { method: "PUT", url: "/icons/icon-192.png" },
    { method: "GET", url: "/api/profile" },
    { method: "GET", url: "/api/chat?stream=1" },
    { method: "GET", url: "/chat" },
    { method: "GET", url: "/profile/_shravyapawar_" },
    { method: "GET", url: "/search/niche/kannada%20songs" },
    { method: "GET", url: "/weekly" },
    { method: "GET", url: "/ideas" },
    { method: "GET", url: "/room" },
    { method: "GET", url: "/discover" },
    { method: "GET", url: "/start" },
    { method: "GET", url: "/" },
    { method: "GET", url: "/?_rsc=abc" },
    { method: "GET", url: "/manifest.webmanifest" },
  ];

  for (const request of refused) {
    assert.equal(
      shouldCache(request),
      false,
      `expected no cache for ${request.method} ${request.url}`,
    );
  }
});

test("shouldCache accepts public build assets, icons, fonts and the offline shell", () => {
  const allowed: CacheRequestLike[] = [
    { method: "GET", url: "/_next/static/chunks/app/page.js" },
    { method: "GET", url: "/_next/static/media/jakarta.woff2" },
    { method: "GET", url: "/icons/icon-192.png" },
    { method: "GET", url: "/icons/icon-512.png?rev=2" },
    { method: "GET", url: "/fonts/space-mono.woff2" },
    { method: "GET", url: "/offline" },
    { method: "GET", url: "/offline/" },
    { method: "GET", url: "/offline.html" },
  ];

  for (const request of allowed) {
    assert.equal(
      shouldCache(request),
      true,
      `expected cache for ${request.method} ${request.url}`,
    );
  }
});

test("the worker's URL/method allow-list stays in sync with lib/pwa", () => {
  const sandbox = workerSandbox();
  const workerShouldCache = sandbox.shouldCache as
    | ((request: CacheRequestLike) => boolean)
    | undefined;
  assert.equal(
    typeof workerShouldCache,
    "function",
    "sw.js must define shouldCache",
  );

  const table: CacheRequestLike[] = [
    { method: "GET", url: "/_next/static/chunks/app/page.js" },
    { method: "GET", url: "/_next/static/css/app.css" },
    { method: "POST", url: "/_next/static/chunk.js" },
    { method: "GET", url: "/api/chat" },
    { method: "GET", url: "/chat" },
    { method: "GET", url: "/profile/_shravyapawar_" },
    { method: "GET", url: "/search/niche/kannada%20songs" },
    { method: "GET", url: "/weekly" },
    { method: "GET", url: "/ideas" },
    { method: "GET", url: "/room" },
    { method: "GET", url: "/discover" },
    { method: "GET", url: "/start" },
    { method: "GET", url: "/" },
    { method: "GET", url: "/icons/icon-192.png" },
    { method: "GET", url: "/icons/maskable-512.png" },
    { method: "GET", url: "/fonts/space-mono.woff2" },
    { method: "GET", url: "/offline" },
    { method: "GET", url: "/manifest.webmanifest" },
  ];

  for (const request of table) {
    assert.equal(
      workerShouldCache!(request),
      shouldCache(request),
      `worker rule drifted for ${request.method} ${request.url}`,
    );
  }
});

test("the worker runtime also requires same-origin GETs and public responses", () => {
  const sandbox = workerSandbox();
  const origin = "https://shambles.test";
  const isCacheableRequest = sandbox.isCacheableRequest as (
    request: { method: string; url: string },
    origin: string,
  ) => boolean;
  const isCacheableResponse = sandbox.isCacheableResponse as (
    response: Record<string, unknown>,
  ) => boolean;

  assert.equal(
    isCacheableRequest(
      { method: "GET", url: `${origin}/_next/static/chunks/app.js` },
      origin,
    ),
    true,
  );
  assert.equal(
    isCacheableRequest(
      { method: "GET", url: "https://evil.test/_next/static/chunks/app.js" },
      origin,
    ),
    false,
    "cross-origin assets must not cache",
  );
  assert.equal(
    isCacheableRequest(
      { method: "POST", url: `${origin}/_next/static/chunks/app.js` },
      origin,
    ),
    false,
  );
  assert.equal(
    isCacheableRequest({ method: "GET", url: `${origin}/api/chat` }, origin),
    false,
  );
  assert.equal(
    isCacheableRequest(
      { method: "GET", url: `${origin}/profile/_shravyapawar_` },
      origin,
    ),
    false,
  );

  const ok = { ok: true, status: 200, type: "basic", headers: headers() };
  assert.equal(isCacheableResponse(ok), true);
  assert.equal(
    isCacheableResponse({
      ...ok,
      headers: headers({ "cache-control": "no-store" }),
    }),
    false,
  );
  assert.equal(
    isCacheableResponse({
      ...ok,
      headers: headers({ "cache-control": "private, max-age=60" }),
    }),
    false,
  );
  assert.equal(
    isCacheableResponse({
      ...ok,
      headers: headers({ "set-cookie": "c101s=secret" }),
    }),
    false,
  );
  assert.equal(isCacheableResponse({ ...ok, type: "opaque" }), false);
  assert.equal(isCacheableResponse({ ...ok, status: 404, ok: false }), false);
});

test("the pure trim rule keeps 120 entries and protects the offline shell", () => {
  const urls = [
    "/offline",
    "/offline.html",
    ...Array.from({ length: 128 }, (_, i) => `/_next/static/chunks/${i}.js`),
  ];
  const stale = cacheEntriesToTrim(urls, CACHE_MAX_ENTRIES);
  assert.equal(stale.length, 10);
  assert.deepEqual(stale, [
    "/_next/static/chunks/0.js",
    "/_next/static/chunks/1.js",
    "/_next/static/chunks/2.js",
    "/_next/static/chunks/3.js",
    "/_next/static/chunks/4.js",
    "/_next/static/chunks/5.js",
    "/_next/static/chunks/6.js",
    "/_next/static/chunks/7.js",
    "/_next/static/chunks/8.js",
    "/_next/static/chunks/9.js",
  ]);
  assert.ok(!stale.includes("/offline"));
  assert.ok(!stale.includes("/offline.html"));

  // No excess: nothing to delete.
  assert.deepEqual(cacheEntriesToTrim(["/offline", "/a.js"], 120), []);
});

test("the worker trims a 130-entry cache to 120 and keeps offline keys", async () => {
  const sandbox = workerSandbox();
  const urls = [
    "/offline",
    "/offline.html",
    ...Array.from({ length: 128 }, (_, i) => `/_next/static/chunks/${i}.js`),
  ];
  const cache = fakeCache(urls);
  const deleted = await sandbox.trimCache(cache, 120);

  assert.equal(deleted, 10);
  assert.equal(cache.size(), 120);
  assert.equal(cache.has("/offline"), true, "offline shell was evicted");
  assert.equal(cache.has("/offline.html"), true, "offline static shell was evicted");
  assert.equal(cache.has("/_next/static/chunks/0.js"), false, "oldest chunk kept");
  assert.equal(cache.has("/_next/static/chunks/9.js"), false, "oldest chunk kept");
  assert.equal(cache.has("/_next/static/chunks/10.js"), true, "newer chunk evicted");
});

test("the worker trim rule stays in sync with lib/pwa", () => {
  const sandbox = workerSandbox();
  const workerTrim = sandbox.cacheEntriesToTrim as (
    urls: string[],
    max?: number,
  ) => string[];
  const cases = [
    [
      "/offline",
      "/offline.html",
      ...Array.from({ length: 128 }, (_, i) => `/_next/static/chunks/${i}.js`),
    ],
    [
      ...Array.from({ length: 60 }, (_, i) => `/_next/static/chunks/a${i}.js`),
      "/offline",
      ...Array.from({ length: 61 }, (_, i) => `/_next/static/chunks/b${i}.js`),
    ],
    ["/offline", "/a.js"],
  ];

  for (const urls of cases) {
    assert.deepEqual(
      Array.from(workerTrim(urls, 120)),
      cacheEntriesToTrim(urls, 120),
      "worker trim rule drifted from lib/pwa",
    );
  }
});

test("cache names are versioned and old app caches are recognisable", () => {
  assert.equal(cacheNameFor("v1"), "shambles-static-v1");
  assert.equal(cacheNameFor("v12"), "shambles-static-v12");
  assert.equal(cacheNameFor("shambles-static-v3"), "shambles-static-v3");
  assert.equal(isAppCache("shambles-static-v1"), true);
  assert.equal(isAppCache("shambles-static-v2"), true);
  assert.equal(isAppCache("other-app"), false);
});

test("isInstallable is true on phones (including iPad desktop mode) and false on desktop", () => {
  assert.equal(isInstallable(IPHONE_SAFARI), true);
  assert.equal(isInstallable(ANDROID_CHROME), true);
  assert.equal(
    isInstallable(
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(isInstallable(IPAD_DESKTOP_SAFARI, 5), true);
  assert.equal(
    isInstallable(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) Gecko/126.0 Firefox/126.0 Mobile",
    ),
    true,
  );
  assert.equal(isInstallable(DESKTOP_CHROME), false);
  assert.equal(isInstallable(DESKTOP_CHROME, 0), false);
  assert.equal(isInstallable(DESKTOP_WINDOWS), false);
  assert.equal(isInstallable(""), false);
});

test("isIosSafari recognises iPhone/iPad Safari and rejects other iOS browsers", () => {
  assert.equal(isIosSafari(IPHONE_SAFARI), true);
  assert.equal(isIosSafari(IPAD_DESKTOP_SAFARI, 5), true);
  assert.equal(
    isIosSafari(IPAD_DESKTOP_SAFARI, 0),
    false,
    "a Mac without touch points is not an iPad",
  );
  assert.equal(isIosSafari(IOS_CHROME), false);
  assert.equal(isIosSafari(IOS_FIREFOX), false);
  assert.equal(isIosSafari(ANDROID_CHROME), false);
  assert.equal(isIosSafari(DESKTOP_CHROME), false);

  for (const token of [
    "Instagram 320.0.0.0",
    "FBAN/FBIOS",
    "FBAV/320.0.0.0",
    "Line/13.0.0",
    "Snapchat/12.0",
    "GSA/320.0.0",
  ]) {
    assert.equal(
      isIosSafari(`${IPHONE_SAFARI} ${token}`),
      false,
      `in-app browser ${token} must not get the Safari hint`,
    );
  }
});

test("visits count the first day as 1 and the prompt waits for the second day", () => {
  assert.deepEqual(nextVisit(null, "2026-11-03"), {
    day: "2026-11-03",
    count: 1,
  });
  assert.deepEqual(
    nextVisit({ day: "2026-11-03", count: 1 }, "2026-11-03"),
    { day: "2026-11-03", count: 1 },
    "a reload on the same day is not a new visit",
  );
  assert.deepEqual(
    nextVisit({ day: "2026-11-03", count: 1 }, "2026-11-04"),
    { day: "2026-11-04", count: 2 },
  );

  const now = Date.UTC(2026, 10, 3);
  assert.equal(
    shouldShowInstallPrompt({
      visits: 1,
      profileOpened: false,
      dismissedAt: null,
      now,
      standalone: false,
      mobile: true,
    }),
    false,
    "the first visit must not show the bar",
  );
  assert.equal(
    shouldShowInstallPrompt({
      visits: 2,
      profileOpened: false,
      dismissedAt: null,
      now,
      standalone: false,
      mobile: true,
    }),
    true,
    "the second distinct day shows the bar",
  );
});

test("install prompt respects profile trigger, dismissal, standalone and mobile", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 10, 3);

  assert.equal(
    shouldShowInstallPrompt({
      visits: 1,
      profileOpened: true,
      dismissedAt: null,
      now,
      standalone: false,
      mobile: true,
    }),
    true,
  );
  assert.equal(
    shouldShowInstallPrompt({
      visits: 5,
      profileOpened: true,
      dismissedAt: now - 29 * day,
      now,
      standalone: false,
      mobile: true,
    }),
    false,
  );
  assert.equal(
    shouldShowInstallPrompt({
      visits: 5,
      profileOpened: true,
      dismissedAt: now - 31 * day,
      now,
      standalone: false,
      mobile: true,
    }),
    true,
  );
  assert.equal(
    shouldShowInstallPrompt({
      visits: 9,
      profileOpened: true,
      dismissedAt: null,
      now,
      standalone: true,
      mobile: true,
    }),
    false,
  );
  assert.equal(
    shouldShowInstallPrompt({
      visits: 9,
      profileOpened: true,
      dismissedAt: null,
      now,
      standalone: false,
      mobile: false,
    }),
    false,
  );
});

test("manifest carries the brand tokens, install modes, icons and shortcuts", () => {
  const app = manifest();
  assert.equal(app.name, "Shambles");
  assert.equal(app.short_name, "Shambles");
  assert.ok(app.description && app.description.length > 20);
  assert.equal(app.start_url, "/");
  assert.equal(app.scope, "/");
  assert.equal(app.display, "standalone");
  assert.equal(app.orientation, "portrait");
  assert.equal(app.background_color, "#09090C");
  assert.equal(app.theme_color, "#09090C");
  assert.ok(Array.isArray(app.categories) && app.categories.length >= 2);

  const icons = app.icons ?? [];
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/icons/icon-192.png" &&
        icon.sizes === "192x192" &&
        icon.type === "image/png" &&
        icon.purpose === "any",
    ),
  );
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/icons/icon-512.png" &&
        icon.sizes === "512x512" &&
        icon.type === "image/png" &&
        icon.purpose === "any",
    ),
  );
  assert.ok(
    icons.some(
      (icon) =>
        icon.src === "/icons/maskable-512.png" &&
        icon.sizes === "512x512" &&
        icon.type === "image/png" &&
        icon.purpose === "maskable",
    ),
  );

  const shortcuts = app.shortcuts ?? [];
  assert.equal(shortcuts.length, 2);
  assert.deepEqual(
    shortcuts.map((shortcut) => shortcut.url).sort(),
    ["/", "/chat"],
  );
});

test("icon PNGs exist at their advertised pixel sizes", () => {
  const expected: Array<[string, number, number]> = [
    ["public/icons/icon-192.png", 192, 192],
    ["public/icons/icon-512.png", 512, 512],
    ["public/icons/maskable-512.png", 512, 512],
    ["public/icons/apple-touch-icon.png", 180, 180],
    ["public/icons/favicon-32.png", 32, 32],
  ];

  for (const [file, width, height] of expected) {
    const size = pngSize(path.join(root, file));
    assert.deepEqual(size, { width, height }, `${file} has the wrong size`);
  }

  const ico = fs.readFileSync(path.join(root, "app/favicon.ico"));
  assert.deepEqual(
    [...ico.subarray(0, 4)],
    [0x00, 0x00, 0x01, 0x00],
    "app/favicon.ico is not an ICO",
  );

  for (const source of [
    "public/icons/src/icon-any.svg",
    "public/icons/src/icon-maskable.svg",
  ]) {
    assert.ok(fs.existsSync(path.join(root, source)), `${source} is missing`);
  }
});

test("the worker precaches a public offline shell, caps the cache and takes over cleanly", () => {
  const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  assert.match(worker, /CACHE_VERSION = "v1"/);
  assert.match(worker, /CACHE_NAME = "shambles-static-" \+ CACHE_VERSION/);
  assert.match(worker, /CACHE_MAX_ENTRIES = 120/);
  assert.match(worker, /OFFLINE_SHELL_URL = "\/offline\.html"/);
  assert.match(worker, /skipWaiting\(\)/);
  assert.match(worker, /clients\.claim\(\)/);
  assert.match(worker, /trimCache\(cache\)/);
  assert.match(worker, /no-store/);
  assert.match(worker, /private/);
  assert.doesNotMatch(worker, /hasCredentials/);
  assert.doesNotMatch(worker, /SKIP_WAITING/);

  const shell = fs.readFileSync(path.join(root, "public/offline.html"), "utf8");
  assert.match(shell, /data-shambles-offline/);
  assert.match(shell, /You&rsquo;re offline/);
  assert.doesNotMatch(shell, /<script/i);

  const register = fs.readFileSync(
    path.join(root, "components/PwaRegister.tsx"),
    "utf8",
  );
  assert.match(register, /registration\.update\(\)/);
  assert.doesNotMatch(register, /pagehide/);
  assert.doesNotMatch(register, /SKIP_WAITING/);
});

test("next.config serves the worker with no-cache and the root scope", () => {
  const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.match(config, /source:\s*"\/sw\.js"/);
  assert.match(config, /"Cache-Control",\s*value:\s*"no-cache"/);
  assert.match(config, /"Service-Worker-Allowed",\s*value:\s*"\/"/);
});
