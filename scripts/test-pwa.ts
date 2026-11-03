// PWA rules, manifest and icon tests. No network and no browser required.
//   npm run test:file -- test-pwa
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import manifest from "../app/manifest";
import {
  cacheNameFor,
  isAppCache,
  isInstallable,
  isIosSafari,
  shouldCache,
  shouldShowInstallPrompt,
  type CacheRequestLike,
} from "../lib/pwa";

const root = process.cwd();

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
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

test("shouldCache refuses writes, private routes and authenticated requests", () => {
  const refused: CacheRequestLike[] = [
    { method: "POST", url: "/_next/static/chunk.js", hasCredentials: false },
    { method: "PUT", url: "/icons/icon-192.png", hasCredentials: false },
    { method: "GET", url: "/api/profile", hasCredentials: false },
    { method: "GET", url: "/api/chat?stream=1", hasCredentials: false },
    { method: "GET", url: "/chat", hasCredentials: false },
    { method: "GET", url: "/profile/_shravyapawar_", hasCredentials: false },
    { method: "GET", url: "/profile/_shravyapawar_", hasCredentials: true },
    { method: "GET", url: "/search/niche/kannada%20songs", hasCredentials: false },
    { method: "GET", url: "/weekly", hasCredentials: false },
    { method: "GET", url: "/ideas", hasCredentials: false },
    { method: "GET", url: "/room", hasCredentials: false },
    { method: "GET", url: "/discover", hasCredentials: false },
    { method: "GET", url: "/start", hasCredentials: false },
    { method: "GET", url: "/", hasCredentials: false },
    { method: "GET", url: "/?_rsc=abc", hasCredentials: false },
    { method: "GET", url: "/manifest.webmanifest", hasCredentials: false },
    { method: "GET", url: "/_next/static/chunk.js", hasCredentials: true },
  ];

  for (const request of refused) {
    assert.equal(
      shouldCache(request),
      false,
      `expected no cache for ${request.method} ${request.url} credentials=${request.hasCredentials}`,
    );
  }
});

test("shouldCache accepts public build assets, icons, fonts and the offline shell", () => {
  const allowed: CacheRequestLike[] = [
    { method: "GET", url: "/_next/static/chunks/app/page.js", hasCredentials: false },
    { method: "GET", url: "/_next/static/media/jakarta.woff2", hasCredentials: false },
    { method: "GET", url: "/icons/icon-192.png", hasCredentials: false },
    { method: "GET", url: "/icons/icon-512.png?rev=2", hasCredentials: false },
    { method: "GET", url: "/fonts/space-mono.woff2", hasCredentials: false },
    { method: "GET", url: "/offline", hasCredentials: false },
    { method: "GET", url: "/offline/", hasCredentials: false },
  ];

  for (const request of allowed) {
    assert.equal(
      shouldCache(request),
      true,
      `expected cache for ${request.method} ${request.url}`,
    );
  }
});

test("the worker's copy of shouldCache stays in sync with lib/pwa", () => {
  const source = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  const sandbox: Record<string, unknown> = {
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

  const workerShouldCache = sandbox.shouldCache as
    | ((request: CacheRequestLike) => boolean)
    | undefined;
  assert.equal(typeof workerShouldCache, "function", "sw.js must define shouldCache");

  const table: CacheRequestLike[] = [
    { method: "GET", url: "/_next/static/chunks/app/page.js", hasCredentials: false },
    { method: "GET", url: "/_next/static/css/app.css", hasCredentials: false },
    { method: "POST", url: "/_next/static/chunk.js", hasCredentials: false },
    { method: "GET", url: "/api/chat", hasCredentials: false },
    { method: "GET", url: "/chat", hasCredentials: false },
    { method: "GET", url: "/profile/_shravyapawar_", hasCredentials: false },
    { method: "GET", url: "/profile/_shravyapawar_", hasCredentials: true },
    { method: "GET", url: "/search/niche/kannada%20songs", hasCredentials: false },
    { method: "GET", url: "/weekly", hasCredentials: false },
    { method: "GET", url: "/ideas", hasCredentials: false },
    { method: "GET", url: "/room", hasCredentials: false },
    { method: "GET", url: "/discover", hasCredentials: false },
    { method: "GET", url: "/start", hasCredentials: false },
    { method: "GET", url: "/", hasCredentials: false },
    { method: "GET", url: "/icons/icon-192.png", hasCredentials: false },
    { method: "GET", url: "/icons/maskable-512.png", hasCredentials: false },
    { method: "GET", url: "/fonts/space-mono.woff2", hasCredentials: false },
    { method: "GET", url: "/offline", hasCredentials: false },
    { method: "GET", url: "/manifest.webmanifest", hasCredentials: false },
  ];

  for (const request of table) {
    assert.equal(
      workerShouldCache!(request),
      shouldCache(request),
      `worker rule drifted for ${request.method} ${request.url} credentials=${request.hasCredentials}`,
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

test("isInstallable is true on phones and false on desktop", () => {
  assert.equal(isInstallable(IOS_SAFARI), true);
  assert.equal(isInstallable(ANDROID_CHROME), true);
  assert.equal(
    isInstallable(
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ),
    true,
  );
  assert.equal(
    isInstallable(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) Gecko/126.0 Firefox/126.0 Mobile",
    ),
    true,
  );
  assert.equal(isInstallable(DESKTOP_CHROME), false);
  assert.equal(isInstallable(DESKTOP_WINDOWS), false);
  assert.equal(isInstallable(""), false);
});

test("isIosSafari only claims Safari on iOS", () => {
  assert.equal(isIosSafari(IOS_SAFARI), true);
  assert.equal(isIosSafari(IOS_CHROME), false);
  assert.equal(isIosSafari(ANDROID_CHROME), false);
  assert.equal(isIosSafari(DESKTOP_CHROME), false);
});

test("install prompt waits for a second visit and respects a 30-day dismissal", () => {
  const day = 24 * 60 * 60 * 1000;
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
  );
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

test("the worker precaches a public offline shell and takes over cleanly", () => {
  const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  assert.match(worker, /CACHE_VERSION = "v1"/);
  assert.match(worker, /CACHE_NAME = "shambles-static-" \+ CACHE_VERSION/);
  assert.match(worker, /OFFLINE_SHELL_URL = "\/offline\.html"/);
  assert.match(worker, /skipWaiting\(\)/);
  assert.match(worker, /clients\.claim\(\)/);
  assert.match(worker, /no-store/);
  assert.match(worker, /private/);

  const shell = fs.readFileSync(path.join(root, "public/offline.html"), "utf8");
  assert.match(shell, /data-shambles-offline/);
  assert.match(shell, /You&rsquo;re offline/);
  assert.doesNotMatch(shell, /<script/i);
});

test("next.config serves the worker with no-cache and the root scope", () => {
  const config = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
  assert.match(config, /source:\s*"\/sw\.js"/);
  assert.match(config, /"Cache-Control",\s*value:\s*"no-cache"/);
  assert.match(config, /"Service-Worker-Allowed",\s*value:\s*"\/"/);
});
