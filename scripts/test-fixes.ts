/**
 * Regression tests for the data-layer fixes.
 *
 * The repo has no test runner, so this follows the pattern the other scripts
 * use: compile with tsc, then run the JS with node.
 *
 *   npx tsc scripts/test-fixes.ts --module commonjs --target es2022 \
 *     --moduleResolution node --outDir .tmp-build --skipLibCheck --esModuleInterop
 *   node --test .tmp-build/scripts/test-fixes.js
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ENV_KEYS = [
  "HIKERAPI_KEY",
  "HIKERAPI_COMMENTS",
  "APIFY_TOKEN",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "YOUTUBE_API_KEY",
  "YOUTUBE_WEB",
  "APIFY_MONTHLY_FREE_USD",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

/** Swap global fetch for the duration of one test. */
async function withFetch<T>(
  handler: (url: string) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    return handler(url);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
    // Attach for callers that want to assert no network happened.
    (fn as unknown as { seen?: string[] }).seen = seen;
  }
}

test("hikerapi puts comments where the harvester reads them", async () => {
  const snap = snapshotEnv();
  process.env.HIKERAPI_KEY = "test-key";
  // Comments are on by default now; only the key needs setting.
  delete process.env.HIKERAPI_COMMENTS;
  try {
    const { hikerapi } = await import("../lib/providers/hikerapi");
    await withFetch(
      async (url) => {
        if (url.includes("/v2/media/info/by/code")) {
          return new Response(
            JSON.stringify({
              id: "123_456",
              code: "ABC123",
              user: { username: "creator", follower_count: 1000 },
              play_count: 5000,
              like_count: 100,
              comment_count: 2,
              taken_at: 1_700_000_000,
              image_versions2: { candidates: [{ url: "https://cdn.example/thumb.jpg" }] },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/v2/media/comments")) {
          return new Response(
            JSON.stringify({
              response: {
                comments: [
                  {
                    text: "how do you do this?",
                    comment_like_count: 3,
                    user: { username: "viewer" },
                    created_at: 1_700_000_100,
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected request: ${url}`);
      },
      async () => {
        const result = await hikerapi.post("https://www.instagram.com/reel/ABC123/");
        const post = (result.data as { post?: Record<string, unknown> }).post ?? {};
        const ext = (post.ext ?? {}) as {
          top_comments?: { text?: string; author?: unknown; username?: string; published_at?: unknown }[];
        };
        assert.equal(
          ext.top_comments?.[0]?.text,
          "how do you do this?",
          "comments must live at post.ext.top_comments, the path fetchInstagramPost reads",
        );
      },
    );
  } finally {
    restoreEnv(snap);
  }
});

test("HikerAPI is first for Instagram paths even when Apify's next call is free", async () => {
  const snap = snapshotEnv();
  process.env.APIFY_TOKEN = "test-token";
  process.env.HIKERAPI_KEY = "test-key";
  // Make the free allowance unambiguously available for the duration of the test.
  process.env.APIFY_MONTHLY_FREE_USD = "999";
  delete process.env.SOCIALCRAWL_API_KEY;
  delete process.env.SCRAPECREATORS_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.DATA_PROVIDER;
  try {
    const { availableProviders, resetCreditLedger } = await import("../lib/providers");
    resetCreditLedger();
    const ids = availableProviders("/instagram/profile/reels").map((p) => p.id);
    const apify = ids.indexOf("apify");
    const hiker = ids.indexOf("hikerapi");
    assert.ok(apify >= 0 && hiker >= 0, `both vendors should be available, got ${ids}`);
    assert.ok(
      hiker < apify,
      `HikerAPI is the primary Instagram vendor, so it must sort first even though Apify's next call is free (got ${ids})`,
    );
  } finally {
    restoreEnv(snap);
  }
});

test("a YouTube handle is remembered under the YouTube cache key", async () => {
  const snap = snapshotEnv();
  const cwd = process.cwd();
  const dir = mkdtempSync(path.join(tmpdir(), "reel-engine-test-"));
  try {
    process.chdir(dir);
    mkdirSync(path.join(dir, "data", "handles"), { recursive: true });
    const yt = path.join(dir, "data", "handles", "testyt--yt.json");
    writeFileSync(
      yt,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        handle: "testyt",
        platform: "youtube",
        reels: [],
        niche: "old phrase",
        nicheSource: "model",
      }),
      "utf8",
    );

    const plan = (await import("../lib/plan")) as unknown as {
      rememberNiche?: (handle: string, guess: { query: string; audience: string; source: string }, platform: string) => Promise<void>;
    };
    assert.equal(typeof plan.rememberNiche, "function", "rememberNiche must be exported for the cache contract");
    await plan.rememberNiche!("testyt", { query: "new phrase", audience: "", source: "shape" }, "youtube");

    const written = JSON.parse(readFileSync(yt, "utf8")) as { niche?: string; platform?: string };
    assert.equal(written.niche, "new phrase", "the YouTube record should be updated in place");
    assert.equal(written.platform, "youtube", "the record must keep naming its network");
    assert.equal(
      existsSync(path.join(dir, "data", "handles", "testyt.json")),
      false,
      "a YouTube read must never create an Instagram-keyed record",
    );
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
    restoreEnv(snap);
  }
});

test("an Instagram handle is never answered by the YouTube reader", async () => {
  const snap = snapshotEnv();
  delete process.env.HIKERAPI_KEY;
  delete process.env.APIFY_TOKEN;
  delete process.env.SOCIALCRAWL_API_KEY;
  delete process.env.SCRAPECREATORS_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_WEB = "1";

  try {
    const { harvestInstagramAccount, NO_INSTAGRAM_DATA_SOURCE } = await import(
      "../lib/harvest"
    );
    const { resetCreditLedger } = await import("../lib/providers");
    resetCreditLedger();

    let networkCalls = 0;
    await assert.rejects(
      () =>
        withFetch(
          async () => {
            networkCalls += 1;
            return new Response("<html></html>", { status: 200 });
          },
          () => harvestInstagramAccount("somebody"),
        ),
      (err: Error) => err.message === NO_INSTAGRAM_DATA_SOURCE,
      "the router must refuse rather than silently read a same-named YouTube channel",
    );
    assert.equal(networkCalls, 0, "no network call may be made on the wrong network");
  } finally {
    restoreEnv(snap);
  }
});

test("one multiple is formatted the same way everywhere", async () => {
  const [{ times: pageTimes, fmtViews }, { times: engineTimes, compact }, { fmt: statsFmt }] =
    await Promise.all([
      import("../lib/plain"),
      import("../lib/fmt"),
      import("../lib/stats"),
    ]);

  for (const n of [1.04, 1.35, 8.2, 24.7, 100.4, 240, 250.6, 3999.8, 12000]) {
    assert.equal(
      pageTimes(n),
      engineTimes(n),
      `plain.times and fmt.times disagree on ${n}`,
    );
  }
  for (const n of [999, 1000, 1234, 12345, 1_234_567, 12_345_678]) {
    assert.equal(fmtViews(n), compact(n), `plain.fmtViews and fmt.compact disagree on ${n}`);
    assert.equal(statsFmt(n), compact(n), `stats.fmt and fmt.compact disagree on ${n}`);
  }
});
