/**
 * Instagram-only enforcement.
 *
 * The bug these tests pin down: an Instagram creator's niche evidence and cohort
 * could be answered by YouTube. The router sorted the free YouTube reader first
 * for keyword search, `searchReelsWithMeta` did not name a platform, and
 * `readOwnAccount` fell back to a same-named YouTube channel. None of that is
 * allowed to happen now: every Instagram path names `platform: "instagram"`,
 * the router tries HikerAPI first, and when no Instagram vendor can answer the
 * caller gets one honest sentence instead of another network's numbers.
 *
 * No network: `withFetch` swaps `globalThis.fetch` for a stub, and the only
 * fixtures read are the recorded HikerAPI responses.
 *
 *   sh scripts/run-test.sh test-instagram-only
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RawReel } from "../lib/types";

const ROOT = process.cwd();

/**
 * One throwaway data root for the cache tests.
 *
 * `lib/niche.ts` resolves its directory at import time, so the root has to be
 * chosen before the module is first loaded. `lib/plan.ts` files handles under
 * `<cwd>/data/handles`, so the working directory moves with it.
 */
const TMP = mkdtempSync(path.join(os.tmpdir(), "reel-engine-instagram-only-"));
process.chdir(TMP);
process.env.CREATORS_DATA_DIR = TMP;

const FIXTURES = path.join(ROOT, "lib/providers/__fixtures__/hikerapi");

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as Json;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Swap global fetch for a stub and record every URL it was asked for. */
async function withFetch<T>(
  handler: (url: string) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<{ value?: T; seen: string[]; calls: number }> {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return handler(url);
  }) as typeof fetch;
  try {
    return { value: await fn(), seen, calls: seen.length };
  } finally {
    globalThis.fetch = real;
  }
}

const ENV_KEYS = [
  "HIKERAPI_KEY",
  "HIKERAPI_USD_PER_CALL",
  "HIKERAPI_COMMENTS",
  "APIFY_TOKEN",
  "APIFY_MONTHLY_FREE_USD",
  "APIFY_ITEM_USD",
  "APIFY_RESULTS_LIMIT",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "YOUTUBE_API_KEY",
  "YOUTUBE_WEB",
  "DATA_PROVIDER",
  "CREDIT_BUDGET",
  "CREDIT_BUDGET_USD",
  "NICHE_CACHE_HOURS",
  "HANDLE_CACHE_HOURS",
  "HARVEST_CACHE_HOURS",
] as const;

const ENV_SNAPSHOT = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ENV_SNAPSHOT[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** The only vendor configured is the keyless YouTube reader. */
function onlyYoutubeReader(): void {
  for (const key of [
    "HIKERAPI_KEY",
    "APIFY_TOKEN",
    "SOCIALCRAWL_API_KEY",
    "SCRAPECREATORS_API_KEY",
    "YOUTUBE_API_KEY",
  ] as const) {
    delete process.env[key];
  }
  process.env.YOUTUBE_WEB = "1";
}

async function resetRouter(): Promise<void> {
  const { resetCreditLedger } = await import("../lib/providers");
  resetCreditLedger();
}

test.after(() => {
  restoreEnv();
  process.chdir(ROOT);
  rmSync(TMP, { recursive: true, force: true });
});

function reel(opts: {
  id: string;
  platform: "instagram" | "youtube";
  account: string;
  views: number;
}): RawReel {
  return {
    id: opts.id,
    platform: opts.platform,
    account: opts.account,
    url: `https://example.test/${opts.id}`,
    caption: `a ${opts.platform} post about kannada songs`,
    postedAt: "2026-10-30T00:00:00.000Z",
    views: opts.views,
    likes: 10,
    comments: 1,
    hashtags: ["kannadasongs"],
  };
}

test("keyword search with only the YouTube reader configured refuses, without calling it", async () => {
  onlyYoutubeReader();
  await resetRouter();
  const { searchReelsWithMeta, NO_INSTAGRAM_DATA_SOURCE } = await import(
    "../lib/harvest"
  );

  const { seen } = await withFetch(
    () => response({ html: "<html></html>" }),
    async () => {
      await assert.rejects(
        () => searchReelsWithMeta("kannada songs"),
        (err: Error) => err.message === NO_INSTAGRAM_DATA_SOURCE,
        "an Instagram search may not fall through to another network",
      );
    },
  );

  assert.deepEqual(seen, [], "the YouTube reader must not be called at all");
});

test("HikerAPI benched and Apify unable to keyword-search yields the same honest message", async () => {
  onlyYoutubeReader();
  process.env.HIKERAPI_KEY = "test-hiker";
  process.env.APIFY_TOKEN = "test-apify";
  process.env.APIFY_MONTHLY_FREE_USD = "999";
  await resetRouter();

  const { searchReelsWithMeta, NO_INSTAGRAM_DATA_SOURCE } = await import(
    "../lib/harvest"
  );

  const { seen } = await withFetch(
    (url) => {
      if (url.includes("api.hikerapi.com")) {
        return response({ detail: "payment required" }, 402);
      }
      throw new Error(`unexpected network call to ${url}`);
    },
    async () => {
      await assert.rejects(
        () => searchReelsWithMeta("kannada songs"),
        (err: Error) => err.message === NO_INSTAGRAM_DATA_SOURCE,
        "Apify's missing keyword search is a skip, not a different error",
      );
    },
  );

  assert.ok(
    seen.some((url) => url.includes("/v2/search/reels")),
    "HikerAPI must be attempted first",
  );
  assert.equal(
    seen.filter((url) => url.includes("api.apify.com")).length,
    0,
    "Apify throws before any network call for keyword search",
  );
});

test("HikerAPI is called first even when Apify's next call is free", async () => {
  onlyYoutubeReader();
  process.env.HIKERAPI_KEY = "test-hiker";
  process.env.HIKERAPI_USD_PER_CALL = "0.05";
  process.env.APIFY_TOKEN = "test-apify";
  process.env.APIFY_MONTHLY_FREE_USD = "999"; // Apify costs $0 right now
  await resetRouter();

  const { availableProviders } = await import("../lib/providers");
  const order = availableProviders("/instagram/search/reels").map((p) => p.id);
  assert.equal(
    order[0],
    "hikerapi",
    `explicit preference must beat price for Instagram paths (got ${order})`,
  );
  assert.equal(order[1], "apify", `Apify must be second (got ${order})`);

  const { searchReelsWithMeta } = await import("../lib/harvest");
  const { value, seen } = await withFetch(
    (url) => {
      if (url.includes("api.hikerapi.com") && url.includes("/v2/search/reels")) {
        return response(fixture("search_reels"));
      }
      throw new Error(`unexpected network call to ${url}`);
    },
    () => searchReelsWithMeta("kannada songs"),
  );

  assert.equal(value?.reels.length, 12, "the recorded page has twelve reels");
  assert.ok(
    value?.reels.every((r) => r.platform === "instagram"),
    "search rows are Instagram rows",
  );
  assert.ok(
    seen.every((url) => url.includes("api.hikerapi.com")),
    "only HikerAPI is asked",
  );
});

test("readOwnAccount refuses Instagram reads instead of falling back to YouTube", async () => {
  const { readOwnAccount } = await import("../lib/plan");
  const { NO_INSTAGRAM_DATA_SOURCE } = await import("../lib/harvest");

  // 1. Only the YouTube reader exists: no Instagram source, no YouTube call.
  onlyYoutubeReader();
  await resetRouter();
  {
    const { seen } = await withFetch(
      () => response({ html: "<html></html>" }),
      async () => {
        await assert.rejects(
          () => readOwnAccount("ghost_handle", false),
          (err: Error) => err.message === NO_INSTAGRAM_DATA_SOURCE,
        );
      },
    );
    assert.deepEqual(seen, [], "a missing Instagram account is not a YouTube channel");
  }

  // 2. HikerAPI says the handle is missing: keep that message, not a fallback.
  onlyYoutubeReader();
  process.env.HIKERAPI_KEY = "test-hiker";
  await resetRouter();
  {
    const { seen } = await withFetch(
      (url) => {
        if (url.includes("api.hikerapi.com")) {
          return response({ detail: "not found", exc_type: "NotFoundException" }, 404);
        }
        throw new Error(`unexpected network call to ${url}`);
      },
      async () => {
        await assert.rejects(
          () => readOwnAccount("ghost_handle", false),
          /not found on Instagram/,
          "a real vendor error must keep its own message",
        );
      },
    );
    assert.ok(
      seen.every((url) => url.includes("api.hikerapi.com")),
      "the YouTube reader must not be tried as a namesake",
    );
  }
});

test("a successful own-account read is Instagram and carries no fallback marker", async () => {
  onlyYoutubeReader();
  process.env.HIKERAPI_KEY = "test-hiker";
  await resetRouter();

  const { readOwnAccount } = await import("../lib/plan");
  const { value } = await withFetch(
    (url) => {
      if (url.includes("/v2/user/by/username")) return response(fixture("user_by_username"));
      if (url.includes("/v2/user/clips")) return response(fixture("user_clips"));
      throw new Error(`unexpected network call to ${url}`);
    },
    () => readOwnAccount("_shravyapawar_", false),
  );

  assert.equal(value?.platform, "instagram");
  assert.equal(value?.fellBackFrom, undefined, "the YouTube fallback is gone");
  assert.ok(value?.reels.length, "the recorded clips page produced rows");
  assert.ok(
    value?.reels.every((r) => r.platform === "instagram"),
    "every own row is Instagram",
  );
});

test("a niche view drops rows from another platform and warns once", async () => {
  const { researchFromCache, nicheView } = await import("../lib/niche");

  const rows = [
    reel({ id: "ig-1", platform: "instagram", account: "ig_creator", views: 1_000 }),
    reel({ id: "ig-2", platform: "instagram", account: "ig_creator", views: 2_000 }),
    reel({ id: "ig-3", platform: "instagram", account: "ig_creator", views: 3_000 }),
    reel({ id: "yt-1", platform: "youtube", account: "yt_channel", views: 90_000 }),
    reel({ id: "yt-2", platform: "youtube", account: "yt_channel", views: 80_000 }),
    reel({ id: "yt-3", platform: "youtube", account: "yt_channel", views: 70_000 }),
  ];

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const research = researchFromCache("kannada songs", rows);
    const view = nicheView(research);

    assert.ok(
      research.payload?.every((r) => r.platform === "instagram"),
      "a niche payload may only hold Instagram rows",
    );
    assert.deepEqual(
      view.top.map((a) => a.handle),
      ["ig_creator"],
      "a YouTube channel may not appear in a niche view",
    );
    assert.ok(
      view.top.every((a) => a.platform === "instagram"),
      "every account in a niche view is Instagram",
    );
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warnings.length, 1, "the drop is reported once, not once per row");
  assert.match(warnings[0], /instagram/i);
});

test("a niche aged 100 hours is cached at NICHE_CACHE_HOURS=168 and stale by default", async () => {
  const { nicheCacheStatus } = await import("../lib/niche");

  const dir = path.join(TMP, "niches");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "cache-test.json"),
    JSON.stringify({
      v: 2,
      fetchedAt: new Date(Date.now() - 100 * 3_600_000).toISOString(),
      query: "cache test",
      payload: [
        reel({ id: "cached-1", platform: "instagram", account: "someone", views: 5_000 }),
      ],
      errors: [],
    }),
    "utf8",
  );

  process.env.NICHE_CACHE_HOURS = "168";
  const long = await nicheCacheStatus("cache test");
  assert.equal(long.ttlHours, 168);
  assert.equal(long.cached, true, "100 hours is inside a 168-hour window");

  delete process.env.NICHE_CACHE_HOURS;
  const normal = await nicheCacheStatus("cache test");
  assert.equal(normal.ttlHours, 12);
  assert.equal(normal.cached, false, "100 hours is outside the 12-hour default");
});

test("a handle aged 100 hours is cached at HANDLE_CACHE_HOURS=168 and stale by default", async () => {
  const { handleIsCached } = await import("../lib/plan");

  const dir = path.join(TMP, "data", "handles");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "cachehandle.json"),
    JSON.stringify({
      fetchedAt: new Date(Date.now() - 100 * 3_600_000).toISOString(),
      handle: "cachehandle",
      platform: "instagram",
      reels: [
        reel({ id: "own-1", platform: "instagram", account: "cachehandle", views: 1_000 }),
      ],
    }),
    "utf8",
  );

  process.env.HANDLE_CACHE_HOURS = "168";
  assert.equal(
    await handleIsCached("cachehandle"),
    true,
    "100 hours is inside a 168-hour window",
  );

  delete process.env.HANDLE_CACHE_HOURS;
  assert.equal(
    await handleIsCached("cachehandle"),
    false,
    "100 hours is outside the 12-hour default",
  );
});

test("the router's Instagram order is explicit, not price-led", async () => {
  restoreEnv();
  delete process.env.DATA_PROVIDER;
  delete process.env.CREDIT_BUDGET;
  delete process.env.CREDIT_BUDGET_USD;
  process.env.HIKERAPI_KEY = "test-hiker";
  process.env.HIKERAPI_USD_PER_CALL = "0.02";
  process.env.APIFY_TOKEN = "test-apify";
  process.env.APIFY_MONTHLY_FREE_USD = "999"; // Apify is the cheaper next call
  process.env.SOCIALCRAWL_API_KEY = "test-socialcrawl";
  process.env.SCRAPECREATORS_API_KEY = "test-scrapecreators";
  process.env.YOUTUBE_WEB = "1";
  process.env.YOUTUBE_API_KEY = "test-youtube";
  await resetRouter();

  const { availableProviders } = await import("../lib/providers");
  const ids = availableProviders("/instagram/search/reels").map((p) => p.id);
  assert.deepEqual(
    ids.slice(0, 4),
    ["hikerapi", "apify", "socialcrawl", "scrapecreators"],
    `Instagram order must be explicit (got ${ids})`,
  );

  const { youtubeweb } = await import("../lib/providers/youtubeweb");
  const { youtube } = await import("../lib/providers/youtube");
  for (const p of ["/instagram/search/reels", "/instagram/profile/reels", "/account/reels"]) {
    assert.equal(youtubeweb.preference?.(p), 99, `youtubeweb must be last for ${p}`);
    assert.equal(youtube.preference?.(p), 99, `youtube must be last for ${p}`);
  }
});

test("an Instagram account search with no Instagram vendor gives the same honest message", async () => {
  onlyYoutubeReader();
  await resetRouter();
  const { searchInstagramAccounts, NO_INSTAGRAM_DATA_SOURCE } = await import(
    "../lib/harvest"
  );

  await assert.rejects(
    () => searchInstagramAccounts("kannada songs"),
    (err: Error) => err.message === NO_INSTAGRAM_DATA_SOURCE,
  );
});

test("a niche search with no Instagram vendor gives the same honest message", async () => {
  onlyYoutubeReader();
  await resetRouter();
  const { researchNiche } = await import("../lib/niche");
  const { NO_INSTAGRAM_DATA_SOURCE } = await import("../lib/harvest");

  const { seen } = await withFetch(
    () => response({ html: "<html></html>" }),
    async () => {
      await assert.rejects(
        () => researchNiche({ query: "a room with no instagram vendor" }),
        (err: Error) => err.message === NO_INSTAGRAM_DATA_SOURCE,
      );
    },
  );
  assert.deepEqual(seen, [], "the YouTube reader must not answer a niche");
});
