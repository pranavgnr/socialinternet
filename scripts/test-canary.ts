// Data-layer hardening tests: vendor canary, Apify's free-plan price, and the
// Business Discovery probe. Everything runs on fixtures + in-memory PGlite:
//   npm run test:file -- test-canary
//
// No vendor is called and no DATABASE_URL is needed. `runCanary` is injected
// with fake providers and a fake fetch so a failure path (a thrown vendor, a
// webhook, a skipped balance) can be exercised without spending money.
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/migrate";
import { resetDbForTests, setDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import { checkCanary, runCanary } from "../lib/canary";
import { price } from "../lib/providers/apify";
import type { DataProvider, ProviderId } from "../lib/providers/types";
import { main, probeBusinessDiscovery } from "./probe-business-discovery";

// PGlite's own query type is close to but not exactly Queryable; adapt it.
function asQueryable(pg: PGlite): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const res = await pg.query<T>(sql, params as never[]);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      return { rows: one.rows as T[] };
    },
  };
}

async function withFreshDb<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const pg = new PGlite();
  const q = asQueryable(pg);
  setDbForTests(q);
  try {
    await migrate(q);
    return await fn(q);
  } finally {
    await pg.close();
    resetDbForTests();
  }
}

// --- fixtures -------------------------------------------------------------

/** One normalised row, in the exact shape harvest.normalise() emits. */
function row(opts: { views?: number; followers?: number | null } = {}) {
  const out: Record<string, unknown> = {
    id: `instagram_${Math.random()}`,
    platform: "instagram",
    account: "natgeo",
    url: "https://www.instagram.com/reel/example/",
    caption: "example",
    postedAt: "2026-10-27T00:00:00.000Z",
    views: opts.views ?? 1_000,
    likes: 10,
    comments: 1,
  };
  if (opts.followers !== null) out.followers = opts.followers ?? 268_267_261;
  return out;
}

/** A unified provider payload (`{ post: { ... } }`) before normalisation. */
function unifiedRows(count: number, opts: { views?: number } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    post: {
      id: `reel-${i}`,
      url: `https://www.instagram.com/reel/${i}/`,
      published_at: "2026-10-27T00:00:00.000Z",
      caption: `reel ${i}`,
      author: { username: "natgeo", followers: 268_267_261 },
      engagement: { views: opts.views ?? 10_000, likes: 100, comments: 4 },
    },
  }));
}

interface FakeOpts {
  rows?: Record<string, unknown>[];
  balance?: { remaining: number | null; ok: boolean; unit?: string };
  throws?: Error;
  calls?: { n: number };
}

function fakeProvider(id: ProviderId, opts: FakeOpts = {}): DataProvider {
  const calls = opts.calls ?? { n: 0 };
  return {
    id,
    name: `Fake ${id}`,
    cost: { usdPerCall: 0.01, label: "test" },
    configured: () => true,
    async profileReels() {
      calls.n += 1;
      if (opts.throws) throw opts.throws;
      return {
        data: { items: opts.rows ?? unifiedRows(10) },
        usd: 0,
        units: 1,
        remaining: null,
      };
    },
    async searchReels() {
      throw new Error("not used");
    },
    async post() {
      throw new Error("not used");
    },
    async profile() {
      throw new Error("not used");
    },
    async balance() {
      return {
        remaining: opts.balance?.remaining ?? 10,
        unit: opts.balance?.unit ?? "credits",
        usdSpent: 0,
        ok: opts.balance?.ok ?? true,
      };
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  } as unknown as Response;
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;
}

// --- checkCanary ----------------------------------------------------------

test("checkCanary passes ten rows with views and followers", () => {
  const sample = Array.from({ length: 10 }, () => row());
  const result = checkCanary("apify", sample);
  assert.equal(result.ok, true);
  assert.match(result.detail, /10/);
});

test("checkCanary fails an empty sample", () => {
  const result = checkCanary("apify", []);
  assert.equal(result.ok, false);
  assert.match(result.detail, /no rows/i);
});

test("checkCanary fails when 8 of 10 rows have zero views", () => {
  const sample = Array.from({ length: 10 }, (_, i) =>
    row({ views: i < 8 ? 0 : 5_000 }),
  );
  const result = checkCanary("apify", sample);
  assert.equal(result.ok, false);
  // 2 of 10 is 20%, below the 50% bar. The detail must say which rule broke.
  assert.match(result.detail, /views/i);
  assert.match(result.detail, /2 of 10/);
});

test("checkCanary accepts exactly 50% of rows with views", () => {
  const sample = Array.from({ length: 10 }, (_, i) =>
    row({ views: i < 5 ? 0 : 5_000 }),
  );
  assert.equal(checkCanary("apify", sample).ok, true);
});

test("checkCanary fails when followers is missing on every row", () => {
  const sample = Array.from({ length: 10 }, () => row({ followers: null }));
  const result = checkCanary("apify", sample);
  assert.equal(result.ok, false);
  assert.match(result.detail, /followers/i);
});

test("checkCanary passes when only one row carries followers", () => {
  const sample = Array.from({ length: 10 }, (_, i) =>
    row({ followers: i === 0 ? 268_267_261 : null }),
  );
  assert.equal(checkCanary("apify", sample).ok, true);
});

// --- Apify price ----------------------------------------------------------

test("apify price is the free-plan rate: $2.70 per 1,000 results", () => {
  // 0.0027 * 1000 is 2.7000000000000002 in binary floating point, so compare
  // rounded to four decimal places rather than with ===.
  const perThousand = Math.round(price("user", 1_000) * 10_000) / 10_000;
  assert.equal(perThousand, 2.7);
});

// --- runCanary ------------------------------------------------------------

test("runCanary tests every vendor once and writes a row per vendor", async () => {
  await withFreshDb(async (q) => {
    const goodCalls = { n: 0 };
    const badCalls = { n: 0 };
    const good = fakeProvider("apify", { calls: goodCalls });
    const bad = fakeProvider("hikerapi", {
      calls: badCalls,
      throws: new Error("vendor is down"),
    });

    const results = await runCanary({ providers: [good, bad] });

    assert.equal(goodCalls.n, 1, "exactly one profile read per vendor");
    assert.equal(badCalls.n, 1);
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((r) => r.vendor),
      ["apify", "hikerapi"],
    );
    assert.equal(results[0]!.ok, true);
    assert.equal(results[1]!.ok, false);
    assert.match(results[1]!.detail, /vendor is down/);

    const { rows } = await q.query<{ vendor: string; ok: boolean; detail: string }>(
      "SELECT vendor, ok, detail FROM vendor_canary ORDER BY id ASC",
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.vendor, "apify");
    assert.equal(rows[0]!.ok, true);
    assert.equal(rows[1]!.vendor, "hikerapi");
    assert.equal(rows[1]!.ok, false);
  });
});

test("runCanary does not throw when one vendor fails", async () => {
  await withFreshDb(async () => {
    const bad = fakeProvider("apify", { throws: new Error("boom") });
    const results = await runCanary({ providers: [bad] });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.ok, false);
  });
});

test("runCanary redacts secrets from a vendor's error message", async () => {
  await withFreshDb(async () => {
    const previous = process.env.APIFY_TOKEN;
    process.env.APIFY_TOKEN = "super-secret-token";
    try {
      const bad = fakeProvider("apify", {
        throws: new Error(
          "POST https://api.apify.com/v2/acts/x/run?token=super-secret-token failed",
        ),
      });
      const [result] = await runCanary({ providers: [bad] });
      assert.equal(result!.ok, false);
      assert.ok(!result!.detail.includes("super-secret-token"));
      assert.match(result!.detail, /redacted/i);
    } finally {
      if (previous === undefined) delete process.env.APIFY_TOKEN;
      else process.env.APIFY_TOKEN = previous;
    }
  });
});

test("runCanary skips a vendor whose balance reports nothing left", async () => {
  await withFreshDb(async (q) => {
    const calls = { n: 0 };
    const empty = fakeProvider("socialcrawl", {
      calls,
      balance: { remaining: 0, ok: true, unit: "credits" },
    });

    const [result] = await runCanary({ providers: [empty] });

    assert.equal(calls.n, 0, "must not spend a call on an empty vendor");
    assert.equal(result!.ok, false);
    assert.match(result!.detail, /skipped/i);
    assert.match(result!.detail, /credits/i);

    const { rows } = await q.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM vendor_canary",
    );
    assert.equal(rows[0]!.n, 1);
  });
});

test("runCanary ?vendor= tests only the named vendor", async () => {
  await withFreshDb(async () => {
    const a = { n: 0 };
    const b = { n: 0 };
    const results = await runCanary({
      providers: [
        fakeProvider("apify", { calls: a }),
        fakeProvider("hikerapi", { calls: b }),
      ],
      vendor: "hikerapi",
    });
    assert.equal(a.n, 0);
    assert.equal(b.n, 1);
    assert.deepEqual(
      results.map((r) => r.vendor),
      ["hikerapi"],
    );
  });
});

test("runCanary never tests a YouTube vendor", async () => {
  await withFreshDb(async () => {
    const calls = { n: 0 };
    const youtube = fakeProvider("youtubeweb", { calls });
    const results = await runCanary({ providers: [youtube] });
    assert.equal(calls.n, 0);
    assert.deepEqual(results, []);
  });
});

test("runCanary posts failures to an http(s) webhook and swallows its errors", async () => {
  await withFreshDb(async () => {
    const previous = process.env.CANARY_WEBHOOK_URL;
    process.env.CANARY_WEBHOOK_URL = "https://hooks.example.test/canary";
    const posts: { url: string; body: string }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: urlOf(input), body: String(init?.body ?? "") });
      throw new Error("webhook is down");
    }) as typeof fetch;

    try {
      const results = await runCanary({
        providers: [fakeProvider("apify", { throws: new Error("no data") })],
        fetch: fakeFetch,
      });
      assert.equal(results[0]!.ok, false);
      assert.equal(posts.length, 1);
      assert.equal(posts[0]!.url, "https://hooks.example.test/canary");
      const body = JSON.parse(posts[0]!.body) as {
        text: string;
        failures: { vendor: string; detail: string }[];
      };
      assert.match(body.text, /canary/i);
      assert.equal(body.failures[0]!.vendor, "apify");
      assert.match(body.failures[0]!.detail, /no data/);
    } finally {
      if (previous === undefined) delete process.env.CANARY_WEBHOOK_URL;
      else process.env.CANARY_WEBHOOK_URL = previous;
    }
  });
});

test("runCanary ignores a non-http(s) webhook URL", async () => {
  await withFreshDb(async () => {
    const previous = process.env.CANARY_WEBHOOK_URL;
    process.env.CANARY_WEBHOOK_URL = "file:///tmp/canary";
    let called = 0;
    const fakeFetch = (async () => {
      called += 1;
      return jsonResponse({});
    }) as typeof fetch;
    try {
      await runCanary({
        providers: [fakeProvider("apify", { throws: new Error("no data") })],
        fetch: fakeFetch,
      });
      assert.equal(called, 0);
    } finally {
      if (previous === undefined) delete process.env.CANARY_WEBHOOK_URL;
      else process.env.CANARY_WEBHOOK_URL = previous;
    }
  });
});

// --- Business Discovery probe --------------------------------------------

const PROBE_TOKEN = "ig-token-should-never-print";

test("probeBusinessDiscovery reports view_count when the API returns it", async () => {
  let requested = "";
  const fakeFetch = (async (input: RequestInfo | URL) => {
    requested = urlOf(input);
    return jsonResponse({
      business_discovery: {
        media: {
          data: [
            {
              id: "1",
              media_type: "VIDEO",
              view_count: 12_345,
              like_count: 200,
              comments_count: 8,
              timestamp: "2026-10-01T00:00:00+0000",
            },
          ],
        },
      },
    });
  }) as typeof fetch;

  const result = await probeBusinessDiscovery({
    igUserId: "17841400000000000",
    token: PROBE_TOKEN,
    target: "natgeo",
    fetch: fakeFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.viewCountPresent, true);
  assert.deepEqual(result.viewCounts, [12_345]);
  const fields = new URL(requested).searchParams.get("fields") ?? "";
  assert.match(fields, /business_discovery\.username\(natgeo\)/);
  assert.match(fields, /view_count/);
  assert.match(fields, /media_type/);
  // The token rides in the request URL (unavoidable for Graph API), but the
  // probe's result and CLI output must never echo that URL.
  assert.equal(new URL(requested).searchParams.get("access_token"), PROBE_TOKEN);
});

test("probeBusinessDiscovery reports view_count as absent when the API omits it", async () => {
  const fakeFetch = (async () =>
    jsonResponse({
      business_discovery: {
        media: {
          data: [
            {
              id: "1",
              media_type: "VIDEO",
              like_count: 200,
              comments_count: 8,
              timestamp: "2026-10-01T00:00:00+0000",
            },
          ],
        },
      },
    })) as typeof fetch;

  const result = await probeBusinessDiscovery({
    igUserId: "17841400000000000",
    token: PROBE_TOKEN,
    target: "natgeo",
    fetch: fakeFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.viewCountPresent, false);
  assert.deepEqual(result.viewCounts, []);
});

test("probeBusinessDiscovery surfaces an API error without the token", async () => {
  const fakeFetch = (async () =>
    jsonResponse(
      { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190 } },
      400,
    )) as typeof fetch;

  const result = await probeBusinessDiscovery({
    igUserId: "17841400000000000",
    token: PROBE_TOKEN,
    target: "natgeo",
    fetch: fakeFetch,
  });

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Invalid OAuth access token/);
  assert.ok(!(result.error ?? "").includes(PROBE_TOKEN));
});

test("the probe CLI prints whether view_count exists and never the token", async () => {
  const lines: string[] = [];
  const fakeFetch = (async () =>
    jsonResponse({
      business_discovery: {
        media: { data: [{ id: "1", view_count: 777, media_type: "VIDEO" }] },
      },
    })) as typeof fetch;

  const code = await main(
    ["17841400000000000", PROBE_TOKEN, "natgeo"],
    { fetch: fakeFetch, log: (line) => lines.push(line), error: (line) => lines.push(line) },
  );

  const output = lines.join("\n");
  assert.equal(code, 0);
  assert.match(output, /view_count: present/i);
  assert.match(output, /777/);
  assert.ok(!output.includes(PROBE_TOKEN));
});

test("the probe CLI exits non-zero with the API error message", async () => {
  const lines: string[] = [];
  const fakeFetch = (async () =>
    jsonResponse({ error: { message: "Unsupported get request" } }, 400)) as typeof fetch;

  const code = await main(
    ["17841400000000000", PROBE_TOKEN, "natgeo"],
    { fetch: fakeFetch, log: (line) => lines.push(line), error: (line) => lines.push(line) },
  );

  assert.equal(code, 1);
  assert.match(lines.join("\n"), /Unsupported get request/);
  assert.ok(!lines.join("\n").includes(PROBE_TOKEN));
});

test.after(() => {
  resetDbForTests();
});
