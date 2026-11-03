// Mobile audit: headless Chrome over CDP, the same pattern as the capture
// scripts in /tmp/shambles-shots. Loads every public route at the founder's
// phone widths and reports overflow, tap targets, input font sizes, overlap
// with the fixed Koko widget and install bar, and console errors.
//
//   node scripts/audit-mobile.mjs
//   AUDIT_BASE=http://127.0.0.1:3300 node scripts/audit-mobile.mjs
//
// Exit code 1 when any finding remains, so "clean" is unambiguous.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.AUDIT_PORT ?? 9337);
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3300";
const OUT = process.env.AUDIT_OUT ?? "/tmp/shambles-shots";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const VIEWPORTS = [
  { label: "360x740", width: 360, height: 740, landscape: false },
  { label: "390x844", width: 390, height: 844, landscape: false },
  { label: "430x932", width: 430, height: 932, landscape: false },
  { label: "844x390", width: 844, height: 390, landscape: true },
];

const ROUTES = [
  { name: "home", path: "/" },
  { name: "profile", path: "/profile/_shravyapawar_" },
  { name: "niche", path: "/search/niche/kannada%20songs" },
  { name: "chat", path: "/chat" },
  { name: "chat-handle", path: "/chat?handle=_shravyapawar_" },
  { name: "offline", path: "/offline" },
  {
    name: "niche-uncached",
    path: "/search/niche/zzz%20uncached%20mobile%20audit",
  },
  { name: "profile-invalid", path: "/profile/this-handle-does-not-exist-xyz" },
];

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.listeners = [];
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
      for (const listener of this.listeners) listener(msg);
      this.events.push(msg);
    });
  }

  onEvent(listener) {
    this.listeners.push(listener);
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

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: !viewport.landscape,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    screenOrientation: viewport.landscape
      ? { type: "landscapePrimary", angle: 90 }
      : { type: "portraitPrimary", angle: 0 },
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
}

async function navigate(cdp, route) {
  cdp.clearEvents();
  await cdp.send("Page.navigate", { url: BASE + route.path });
  await cdp.waitFor("Page.loadEventFired", 25000);
  await sleep(650);
  await evaluate(cdp, "document.fonts.ready.then(() => true)");
  await sleep(200);
}

const AUDIT_IN_PAGE = String.raw`(async () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  function visible(el) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) <= 0.01) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    return true;
  }

  function label(el) {
    const text = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return (text || el.tagName.toLowerCase()).slice(0, 60);
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  }

  function isProseLink(el) {
    if (el.tagName !== "A") return false;
    const style = getComputedStyle(el);
    if (style.display !== "inline") return false;
    const parent = el.parentElement;
    return Boolean(parent && parent.closest("p,li") && !el.querySelector("img,svg"));
  }

  const selector = [
    "a",
    "button",
    "input",
    "textarea",
    "select",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  const nodes = Array.from(document.querySelectorAll(selector)).filter((el) => {
    if (!visible(el)) return false;
    if (el.closest(".sr-only")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("disabled")) return false;
    return true;
  });

  const targets = nodes.filter((el) => !isProseLink(el));
  const small = [];
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) {
      small.push({
        tag: el.tagName.toLowerCase(),
        label: label(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
      });
    }
  }

  const inputs = nodes.filter((el) =>
    el.matches('input,textarea,select,[contenteditable="true"]'),
  );
  const smallInputs = [];
  for (const el of inputs) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 16) {
      smallInputs.push({ tag: el.tagName.toLowerCase(), label: label(el), size });
    }
  }

  // Micro labels must stay at least 11px on phones. Walk real text nodes so an
  // inherited 11px is measured where the reader actually sees it.
  const smallText = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const value = (textNode.textContent || "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const el = textNode.parentElement;
    if (!el) continue;
    if (el.closest("script,style,noscript,svg,.sr-only,[aria-hidden='true']")) continue;
    if (!visible(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 10.99) {
      smallText.push({
        tag: el.tagName.toLowerCase(),
        label: value.slice(0, 50),
        size,
      });
    }
  }

  const overlays = [];
  const koko = document.querySelector(".koko-aura");
  if (koko && visible(koko)) overlays.push({ name: "koko", el: koko, rect: rectOf(koko) });
  const install = document.querySelector("[data-install-prompt]");
  if (install && visible(install)) {
    overlays.push({ name: "install", el: install, rect: rectOf(install) });
  }

  // A fixed bar can sit over content at rest. What matters is whether the
  // control can be brought clear by scrolling: with the reserved bottom space
  // it always can. Only report "blocking" overlaps that survive scrollIntoView.
  // The install bar must sit above Koko, not on top of it.
  const overlayCollisions = [];
  for (let i = 0; i < overlays.length; i++) {
    for (let j = i + 1; j < overlays.length; j++) {
      const a = overlays[i].rect;
      const b = overlays[j].rect;
      const ox = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) {
        overlayCollisions.push({
          overlay: overlays[i].name + "↔" + overlays[j].name,
          label: "fixed widgets overlap",
          ox: Math.round(ox),
          oy: Math.round(oy),
        });
      }
    }
  }

  const overlaps = [...overlayCollisions];
  let overlapsAtRest = 0;
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const overlay of overlays) {
    for (const el of [...targets, ...inputs]) {
      if (overlay.el.contains(el)) continue;
      const r = el.getBoundingClientRect();
      let ox = Math.min(r.right, overlay.rect.right) - Math.max(r.left, overlay.rect.x);
      let oy = Math.min(r.bottom, overlay.rect.bottom) - Math.max(r.top, overlay.rect.y);
      if (ox <= 2 || oy <= 2) continue;

      overlapsAtRest += 1;
      const originalY = window.scrollY;
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      await nextFrame();
      const moved = el.getBoundingClientRect();
      ox = Math.min(moved.right, overlay.rect.right) - Math.max(moved.left, overlay.rect.x);
      oy = Math.min(moved.bottom, overlay.rect.bottom) - Math.max(moved.top, overlay.rect.y);
      window.scrollTo(0, originalY);
      if (ox > 2 && oy > 2) {
        overlaps.push({
          overlay: overlay.name,
          tag: el.tagName.toLowerCase(),
          label: label(el),
          ox: Math.round(ox),
          oy: Math.round(oy),
        });
      }
    }
  }
  window.scrollTo(0, 0);

  const scrollWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0,
  );
  const overflow = Math.max(0, scrollWidth - vw);
  const overflowers = [];
  if (overflow > 1) {
    for (const el of Array.from(document.body ? document.body.querySelectorAll("*") : [])) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        const style = getComputedStyle(el);
        if (style.position === "fixed") continue;
        overflowers.push({
          tag: el.tagName.toLowerCase(),
          label: label(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
        });
      }
    }
  }

  return {
    vw,
    vh,
    scrollWidth,
    overflow,
    overflowers: overflowers.slice(0, 8),
    small: small.slice(0, 25),
    smallCount: small.length,
    smallInputs: smallInputs.slice(0, 10),
    smallInputCount: smallInputs.length,
    smallText: smallText.slice(0, 20),
    smallTextCount: smallText.length,
    overlaps: overlaps.slice(0, 20),
    overlapCount: overlaps.length,
    overlapsAtRest,
    installVisible: Boolean(install && visible(install)),
  };
})()`;

function pad(value, width) {
  return String(value).padEnd(width);
}

function listLabels(items, count = 4) {
  if (!items.length) return "";
  return items
    .slice(0, count)
    .map((item) =>
      item.overlay
        ? `${item.overlay}:${item.label}[${item.ox}x${item.oy}]`
        : `${item.label}[${item.w ?? item.size}x${item.h ?? ""}]`,
    )
    .join(", ");
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const chromeDir = path.join(OUT, "chrome-mobile-audit");
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
    await cdp.send("Log.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setUserAgentOverride", {
      userAgent: IPHONE_UA,
      platform: "iPhone",
    });

    let consoleErrors = [];
    cdp.onEvent((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        consoleErrors.push(`exception: ${msg.params.exceptionDetails.text}`);
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        consoleErrors.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`.trim());
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        consoleErrors.push(
          `console: ${msg.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`,
        );
      }
    });

    const rows = [];
    for (const viewport of VIEWPORTS) {
      await setViewport(cdp, viewport);
      for (const route of ROUTES) {
        consoleErrors = [];
        let result = null;
        let navigationError = null;
        try {
          await navigate(cdp, route);
          result = await evaluate(cdp, AUDIT_IN_PAGE);
        } catch (error) {
          navigationError = error.message;
        }

        const shot = `${OUT}/mobile-${viewport.label}-${route.name}.png`;
        try {
          const { data } = await cdp.send("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
          });
          await fs.writeFile(shot, Buffer.from(data, "base64"));
        } catch {
          // A failed screenshot is reported through the row.
        }

        const row = {
          viewport: viewport.label,
          route: route.path,
          overflow: result?.overflow ?? null,
          small: result?.smallCount ?? null,
          inputs: result?.smallInputCount ?? null,
          text: result?.smallTextCount ?? null,
          overlaps: result?.overlapCount ?? null,
          errors: consoleErrors.length,
          detail: [
            navigationError ? `navigation: ${navigationError}` : "",
            result?.overflow > 1 ? `overflowing: ${listLabels(result.overflowers, 3)}` : "",
            result?.smallCount ? `small: ${listLabels(result.small, 12)}` : "",
            result?.smallInputCount ? `inputs: ${listLabels(result.smallInputs, 3)}` : "",
            result?.smallTextCount ? `text<11: ${listLabels(result.smallText, 5)}` : "",
            result?.overlapCount ? `overlap: ${listLabels(result.overlaps, 3)}` : "",
            !result?.overlapCount && result?.overlapsAtRest
              ? `${result.overlapsAtRest} control(s) behind a fixed bar at rest, all scroll clear`
              : "",
            consoleErrors.length ? `errors: ${consoleErrors.slice(0, 2).join(" | ")}` : "",
          ]
            .filter(Boolean)
            .join("; "),
        };
        rows.push(row);

        const bad =
          navigationError ||
          !result ||
          result.overflow > 1 ||
          result.smallCount > 0 ||
          result.smallInputCount > 0 ||
          result.smallTextCount > 0 ||
          result.overlapCount > 0 ||
          consoleErrors.length > 0;
        if (bad) exitCode = 1;
      }
    }

    // Keyboard-open simulation: a short visual viewport, focus the composer and
    // the landing audit box, and make sure the caret is still on screen and not
    // behind Koko or the install bar.
    const keyboardRows = [];
    await setViewport(cdp, {
      label: "keyboard",
      width: 390,
      height: 420,
      landscape: false,
    });

    const keyboardCases = [
      {
        name: "chat",
        route: "/chat",
        focus: "document.getElementById('koko-message')",
        shot: `${OUT}/mobile-keyboard-chat.png`,
      },
      {
        name: "audit",
        route: "/",
        focus: "document.querySelector('main input[type=\"text\"]')",
        shot: `${OUT}/mobile-keyboard-audit.png`,
      },
    ];

    if (process.env.AUDIT_SESSION) {
      // A temporary signed-in session lets the keyboard check exercise the
      // real Koko composer instead of the anonymous sign-in card.
      await cdp.send("Network.setCookie", {
        name: "c101s",
        value: process.env.AUDIT_SESSION,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
      });
    }

    for (const item of keyboardCases) {
      consoleErrors = [];
      let outcome = null;
      try {
        if (item.name === "chat" && process.env.AUDIT_SESSION) {
          await cdp.send("Network.setCookie", {
            name: "c101s",
            value: process.env.AUDIT_SESSION,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
          });
        }
        if (item.name !== "chat") {
          await cdp
            .send("Network.deleteCookies", { name: "c101s", domain: "127.0.0.1" })
            .catch(() => undefined);
        }
        await navigate(cdp, { path: item.route });
        const found = await evaluate(
          cdp,
          `(() => { const el = ${item.focus}; if (!el) return false; el.focus(); return true; })()`,
        );
        if (!found) {
          keyboardRows.push({ case: item.name, outcome: { missing: true } });
          continue;
        }
        await sleep(450);
        outcome = await evaluate(
          cdp,
          `(() => {
            const el = document.activeElement;
            if (!el) return { focused: false };
            const r = el.getBoundingClientRect();
            const vv = window.visualViewport;
            const koko = document.querySelector(".koko-aura");
            const install = document.querySelector("[data-install-prompt]");
            const overlayRects = [];
            if (koko) overlayRects.push({ name: "koko", rect: koko.getBoundingClientRect() });
            if (install) overlayRects.push({ name: "install", rect: install.getBoundingClientRect() });
            const overlaps = [];
            for (const overlay of overlayRects) {
              const o = overlay.rect;
              const ox = Math.min(r.right, o.right) - Math.max(r.left, o.left);
              const oy = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
              if (ox > 2 && oy > 2) overlaps.push(overlay.name);
            }
            return {
              focused: true,
              tag: el.tagName.toLowerCase(),
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              height: Math.round(r.height),
              viewportHeight: Math.round(vv ? vv.height : window.innerHeight),
              visible: r.top >= -1 && r.bottom <= (vv ? vv.height : window.innerHeight) + 1,
              overlaps,
            };
          })()`,
        );
        const { data } = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
        });
        await fs.writeFile(item.shot, Buffer.from(data, "base64"));
      } catch (error) {
        outcome = { error: error.message };
      }

      const skipped = outcome?.missing && !process.env.AUDIT_SESSION;
      const bad =
        !skipped &&
        (!outcome ||
          outcome.error ||
          !outcome.focused ||
          !outcome.visible ||
          (outcome.overlaps?.length ?? 0) > 0);
      if (bad) exitCode = 1;
      keyboardRows.push({ case: item.name, outcome, skipped });
    }

    console.log("");
    console.log(
      `${pad("VIEW", 10)}${pad("ROUTE", 42)}${pad("OVERFLOW", 10)}${pad("TARGETS", 9)}${pad("INPUTS", 8)}${pad("TEXT<11", 9)}${pad("OVERLAP", 9)}${pad("ERRORS", 8)}`,
    );
    console.log("-".repeat(105));
    for (const row of rows) {
      console.log(
        `${pad(row.viewport, 10)}${pad(row.route, 42)}${pad(row.overflow === null ? "FAIL" : `${row.overflow}px`, 10)}${pad(row.small ?? "-", 9)}${pad(row.inputs ?? "-", 8)}${pad(row.text ?? "-", 9)}${pad(row.overlaps ?? "-", 9)}${pad(row.errors, 8)}`,
      );
      if (row.detail) console.log(`  └ ${row.detail}`);
    }

    console.log("");
    console.log("Keyboard-open (390x420)");
    console.log("-".repeat(96));
    for (const row of keyboardRows) {
      const o = row.outcome ?? {};
      const status =
        row.skipped
          ? "SKIPPED (no composer while signed out; set AUDIT_SESSION to test it)"
          : o.error
            ? `ERROR ${o.error}`
            : !o.focused
              ? "NO FOCUS"
              : o.visible && !(o.overlaps?.length)
                ? "ok"
                : `FAIL top=${o.top} bottom=${o.bottom} vh=${o.viewportHeight} overlaps=${(o.overlaps ?? []).join(",")}`;
      console.log(`${pad(row.case, 12)}${status}`);
    }

    const findings = rows.filter(
      (row) =>
        row.overflow > 1 ||
        row.small > 0 ||
        row.inputs > 0 ||
        row.text > 0 ||
        row.overlaps > 0 ||
        row.errors > 0 ||
        row.overflow === null,
    ).length;
    console.log("");
    console.log(
      `${rows.length} viewport/route combinations, ${findings} with findings. Screenshots: ${OUT}/mobile-*.png`,
    );
    console.log(exitCode === 0 ? "MOBILE AUDIT CLEAN" : "MOBILE AUDIT HAS FINDINGS");
  } finally {
    chrome.kill("SIGTERM");
    await sleep(300);
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
