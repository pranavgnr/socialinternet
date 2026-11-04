/**
 * The live verification's argument parser and real-money cap.
 *
 * The cap is the only thing between a test run and the rest of the wallet, so
 * it is tested with a fake fetch and an injected exit. No network, no live key.
 *
 *   sh scripts/run-test.sh test-live-guard
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  installGuard,
  parseArgs,
  UsageError,
  vendorEndpoint,
} from "../lib/liveGuard";

test("parseArgs defaults to a 40-call cap and takes handle + niche", () => {
  assert.deepEqual(parseArgs(["creator", "kannada songs"]), {
    handle: "creator",
    niche: "kannada songs",
    cap: 40,
    force: false,
    cached: false,
    peers: true,
  });
  assert.equal(parseArgs(["creator", "kannada songs", "--cap", "7"]).cap, 7);
  assert.equal(parseArgs(["creator", "kannada songs", "--cap", "7.9"]).cap, 7);
});

test("parseArgs refuses a cap that is zero, negative or not a number", () => {
  for (const value of ["0", "-3", "abc", ""]) {
    assert.throws(
      () => parseArgs(["creator", "kannada songs", "--cap", value]),
      UsageError,
      `--cap ${value || "(empty)"} must be refused`,
    );
  }
});

test("parseArgs requires a value for --warm and a handle for a plan", () => {
  const warm = parseArgs(["--warm", "telugu songs cover"]);
  assert.equal(warm.warm, "telugu songs cover");
  assert.equal(warm.handle, undefined);

  assert.throws(() => parseArgs(["--warm"]), UsageError);
  assert.throws(() => parseArgs(["--warm", "--cap", "5"]), UsageError);
  assert.throws(() => parseArgs([]), UsageError);
  assert.throws(() => parseArgs(["only-a-handle"]), UsageError);
});

test("the guard counts vendor requests and lets exactly cap through", async () => {
  const seen: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    seen.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  let exited: number | null = null;

  const guard = installGuard({
    cap: 2,
    fetchImpl: fake,
    exit: (code) => {
      exited = code;
    },
    log: () => {},
  });
  try {
    await globalThis.fetch("https://api.hikerapi.com/v2/user/by/username");
    await globalThis.fetch("https://api.apify.com/v2/acts/example/run");
    assert.equal(seen.length, 2, "both allowed calls reach the underlying fetch");
    assert.equal(guard.tally.calls, 2);
    assert.deepEqual(Object.fromEntries(guard.tally.byVendor), {
      hikerapi: 1,
      apify: 1,
    });

    await assert.rejects(
      () => globalThis.fetch("https://api.hikerapi.com/v2/user/clips"),
      /cap reached/,
    );
    assert.equal(seen.length, 2, "the refused request is never sent");
    assert.equal(guard.tally.calls, 2, "the tally stops at the cap");
    assert.equal(exited, 3, "the abort path runs with exit code 3");
  } finally {
    guard.restore();
  }
});

test("/sys/ balance checks are free and never count against the cap", async () => {
  const seen: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    seen.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  let exited: number | null = null;

  const guard = installGuard({
    cap: 1,
    fetchImpl: fake,
    exit: (code) => {
      exited = code;
    },
    log: () => {},
  });
  try {
    await globalThis.fetch("https://api.hikerapi.com/sys/balance");
    await globalThis.fetch("https://api.hikerapi.com/sys/balance");
    await globalThis.fetch("https://api.hikerapi.com/v2/search/reels");
    assert.equal(guard.tally.calls, 1);
    assert.equal(exited, null);

    await assert.rejects(
      () => globalThis.fetch("https://api.hikerapi.com/v2/user/clips"),
      /cap reached/,
    );
    assert.equal(guard.tally.calls, 1);
    assert.equal(exited, 3);
  } finally {
    guard.restore();
  }
});

test("every vendor HTTP request counts, including a retry or billed failure", async () => {
  const fake = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  let exited: number | null = null;

  const guard = installGuard({
    cap: 2,
    fetchImpl: fake,
    exit: (code) => {
      exited = code;
    },
    log: () => {},
  });
  try {
    await globalThis.fetch("https://api.hikerapi.com/v2/user/by/username");
    await globalThis.fetch("https://api.hikerapi.com/v2/user/by/username");
    assert.equal(guard.tally.calls, 2, "a retry is a second request and is counted");
    assert.equal(guard.tally.byEndpoint.get("/v2/user/by/username"), 2);
    assert.equal(exited, null);

    await assert.rejects(
      () => globalThis.fetch("https://api.hikerapi.com/v2/user/by/username"),
      /cap reached/,
    );
    assert.equal(guard.tally.calls, 2);
    assert.equal(exited, 3);
  } finally {
    guard.restore();
  }
});

test("a non-vendor URL is not counted and is never blocked", async () => {
  const seen: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    seen.push(String(input));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  let exited: number | null = null;

  const guard = installGuard({
    cap: 1,
    fetchImpl: fake,
    exit: (code) => {
      exited = code;
    },
    log: () => {},
  });
  try {
    await globalThis.fetch("https://example.com/health");
    await globalThis.fetch("https://api.hikerapi.com/v2/search/reels");
    await globalThis.fetch("https://example.com/health");
    assert.equal(guard.tally.calls, 1, "only the vendor request is counted");
    assert.equal(exited, null);

    await assert.rejects(
      () => globalThis.fetch("https://api.hikerapi.com/v2/user/clips"),
      /cap reached/,
    );
    assert.equal(guard.tally.calls, 1);
    assert.equal(exited, 3);
    assert.equal(
      seen.filter((url) => url.startsWith("https://example.com")).length,
      2,
      "non-vendor traffic keeps working after the cap is reached",
    );
  } finally {
    guard.restore();
  }
});

test("vendorEndpoint classifies the two vendor hosts and the free balance path", () => {
  assert.deepEqual(
    vendorEndpoint("https://api.hikerapi.com/v2/user/clips?user_id=1"),
    { vendor: "hikerapi", endpoint: "/v2/user/clips" },
  );
  assert.deepEqual(
    vendorEndpoint("https://api.apify.com/v2/acts/x/run"),
    { vendor: "apify", endpoint: "/v2/acts/x/run" },
  );
  assert.equal(vendorEndpoint("https://api.hikerapi.com/sys/balance"), null);
  assert.equal(vendorEndpoint("https://example.com/anything"), null);
  assert.equal(vendorEndpoint("not a url"), null);
});
