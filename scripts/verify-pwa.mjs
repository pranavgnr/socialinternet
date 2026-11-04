// Production PWA verification against a running `next start`.
//   node scripts/verify-pwa.mjs
//   PWA_BASE=http://127.0.0.1:3300 node scripts/verify-pwa.mjs
//
// Checks the manifest + icons + headers over HTTP, then drives headless Chrome
// over CDP to prove the worker registers, precaches /offline, caches no private
// pages, and serves the offline shell when the network is cut.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PWA_PORT ?? 9338);
const BASE = process.env.PWA_BASE ?? "http://127.0.0.1:3300";
const OUT = process.env.PWA_OUT ?? "/tmp/shambles-shots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
        else entry.resolve(msg.result);
        return;
      }
      this.events.push(msg);
    });
  }
  clearEvents() {
    this.events = [];
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(method, timeout = 20000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const found = this.events.find((event) => event.method === method);
        if (found) {
          this.events = this.events.filter((event) => event !== found);
          resolve(found.params);
          return;
        }
        if (Date.now() - started > timeout) {
          reject(new Error(`timeout waiting for ${method}`));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }
}

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await res.json();
      const page = tabs.find((tab) => tab.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
        });
        return new CDP(ws);
      }
    } catch {
      // Chrome is still starting.
    }
    await sleep(150);
  }
  throw new Error("could not connect to Chrome");
}


async function connectTarget(predicate) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const tabs = await res.json();
  const target = tabs.find(predicate);
  if (!target) return null;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send("Network.enable").catch(() => undefined);
  return cdp;
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.text ?? "evaluation failed");
  }
  return result.value;
}

async function navigate(cdp, url, timeout = 20000) {
  cdp.clearEvents();
  await cdp.send("Page.navigate", { url });
  await cdp.waitFor("Page.loadEventFired", timeout);
  await sleep(700);
}

function validateManifest(manifest) {
  const icons = manifest.icons ?? [];
  const problems = [];
  if (manifest.name !== "Shambles") problems.push("name");
  if (manifest.short_name !== "Shambles") problems.push("short_name");
  if (manifest.start_url !== "/") problems.push("start_url");
  if (manifest.scope !== "/") problems.push("scope");
  if (manifest.display !== "standalone") problems.push("display");
  if (manifest.orientation !== "portrait") problems.push("orientation");
  if (manifest.background_color !== "#09090C") problems.push("background_color");
  if (manifest.theme_color !== "#09090C") problems.push("theme_color");
  if (!icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any")) {
    problems.push("icon-192");
  }
  if (!icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any")) {
    problems.push("icon-512");
  }
  if (!icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")) {
    problems.push("maskable-512");
  }
  if (!Array.isArray(manifest.shortcuts) || manifest.shortcuts.length < 2) {
    problems.push("shortcuts");
  }
  return problems;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  // 1. Manifest over HTTP.
  const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await manifestRes.json();
  const problems = validateManifest(manifest);
  check("manifest is served and valid", manifestRes.ok && problems.length === 0, problems.join(", "));

  const homeRes = await fetch(`${BASE}/`);
  const home = await homeRes.text();
  check(
    "home links the manifest",
    /<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/.test(home) ||
      /<link[^>]+href="\/manifest\.webmanifest"[^>]+rel="manifest"/.test(home),
  );
  check(
    "home sets standalone theme + viewport-fit",
    /<meta[^>]+name="theme-color"[^>]+content="#09090C"/.test(home) &&
      /viewport-fit=cover/.test(home),
  );
  check(
    "home links the apple touch icon",
    /<link[^>]+rel="apple-touch-icon"[^>]+href="\/icons\/apple-touch-icon\.png"/.test(home),
  );

  const swRes = await fetch(`${BASE}/sw.js`);
  check(
    "/sw.js is revalidated and scoped to /",
    swRes.ok &&
      (swRes.headers.get("cache-control") ?? "").includes("no-cache") &&
      swRes.headers.get("service-worker-allowed") === "/",
    `${swRes.headers.get("cache-control")} / ${swRes.headers.get("service-worker-allowed")}`,
  );

  for (const icon of [
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/maskable-512.png",
    "/icons/apple-touch-icon.png",
  ]) {
    const res = await fetch(BASE + icon);
    check(`${icon} is served`, res.ok && (res.headers.get("content-type") ?? "").includes("image/png"));
  }

  // 2. Worker registration in a real browser.
  const chromeDir = path.join(OUT, "chrome-pwa-verify");
  await fs.rm(chromeDir, { recursive: true, force: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${chromeDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let exitCode = 0;
  try {
    const cdp = await connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent: IPHONE_UA,
      platform: "iPhone",
    });

    await navigate(cdp, `${BASE}/offline`);
    const registration = await evaluate(
      cdp,
      `navigator.serviceWorker.ready.then((registration) => ({
        scope: registration.scope,
        active: registration.active ? registration.active.state : null,
        controller: Boolean(navigator.serviceWorker.controller),
      }))`,
    );
    check(
      "service worker is active on localhost",
      registration?.active === "activated" && registration?.scope.endsWith("/"),
      JSON.stringify(registration),
    );

    // Visit a page with a worker controlling it, so a reload has a controller.
    await navigate(cdp, `${BASE}/offline`);
    const controlled = await evaluate(cdp, "Boolean(navigator.serviceWorker.controller)");
    check("an activated worker controls the page", controlled === true);

    const cacheState = await evaluate(
      cdp,
      `(async () => {
        const names = await caches.keys();
        const cache = await caches.open("shambles-static-v1");
        const keys = await cache.keys();
        return {
          names,
          urls: keys.map((request) => new URL(request.url).pathname),
        };
      })()`,
    );
    const urls = cacheState?.urls ?? [];
    check(
      "the versioned cache exists",
      (cacheState?.names ?? []).includes("shambles-static-v1"),
      (cacheState?.names ?? []).join(", "),
    );
    check("/offline is precached", urls.includes("/offline"), urls.join(", "));
    check(
      "only public assets are cached",
      urls.every(
        (url) =>
          url === "/offline" ||
          url === "/offline.html" ||
          url.startsWith("/_next/static/") ||
          url.startsWith("/icons/") ||
          url.startsWith("/fonts/") ||
          /\.(woff2?|ttf|otf|eot)$/i.test(url),
      ),
      urls.join(", "),
    );

    // Visit a private route so we can prove it was not stored.
    await navigate(cdp, `${BASE}/profile/_shravyapawar_`);
    const afterPrivate = await evaluate(
      cdp,
      `(async () => {
        const cache = await caches.open("shambles-static-v1");
        const keys = await cache.keys();
        return keys.map((request) => new URL(request.url).pathname);
      })()`,
    );
    check(
      "a profile navigation is not cached",
      !afterPrivate.some((url) => url.startsWith("/profile/")),
      afterPrivate.join(", "),
    );

    // 3. Offline reload must serve the /offline shell.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    // The page's offline emulation does not cover the worker's own network
    // stack, so put the worker target offline too.
    const workerTarget = await connectTarget(
      (target) =>
        target.type === "service_worker" && target.url === `${BASE}/sw.js`,
    );
    await workerTarget
      ?.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      })
      .catch(() => undefined);
    // Navigate to the same visited profile with a fresh query, so the worker
    // cannot be bypassed by a same-document memory hit.
    await navigate(cdp, `${BASE}/profile/_shravyapawar_?offline=1`, 20000);
    const offline = await evaluate(
      cdp,
      `({
        path: location.pathname,
        shell: Boolean(document.querySelector("[data-shambles-offline]")),
        text: document.body ? document.body.innerText : "",
      })`,
    );
    check(
      "offline reload serves the /offline shell",
      offline?.shell === true && /offline/i.test(offline?.text ?? ""),
      JSON.stringify({ path: offline?.path, shell: offline?.shell, text: (offline?.text ?? "").slice(0, 80) }),
    );

    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    await fs.writeFile(`${OUT}/pwa-offline.png`, Buffer.from(data, "base64"));

    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) exitCode = 1;
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
