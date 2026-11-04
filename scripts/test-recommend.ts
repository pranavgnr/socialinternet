// Route-level tests for POST /api/recommend without Next. Real gate and settle,
// so each fresh room's charge/refund is exercised on PGlite; the pull is a spy.
//   npm run test:file -- test-recommend
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/migrate";
import { setDbForTests, resetDbForTests, type Queryable } from "../lib/db";
import { balance, spend } from "../lib/credits";
import { COSTS } from "../lib/costs";
import { recordDirectSpend } from "../lib/providers";
import { runRecommendPulls, type RecommendPullsDeps } from "../lib/recommendRequest";
import type { SessionUser } from "../lib/auth";
import type { NicheResearch } from "../lib/niche";
import type { RawReel } from "../lib/types";

const T0 = new Date("2026-11-02T10:00:00Z");

function asQueryable(pg: PGlite): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const res = await pg.query<T>(sql, params as never[]);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      return { rows: one.rows as T[] };
    },
  };
}

async function withFreshDb<T>(
  fn: (q: Queryable, userId: string) => Promise<T>,
): Promise<T> {
  const pg = new PGlite();
  const q = asQueryable(pg);
  setDbForTests(q);
  try {
    await migrate(q);
    const userId = randomUUID();
    await q.query(
      "INSERT INTO users (id, email, created_at) VALUES ($1, $2, now())",
      [userId, "creator@example.com"],
    );
    return await fn(q, userId);
  } finally {
    await pg.close();
  }
}

function sessionUser(id: string): SessionUser {
  return { id, email: "creator@example.com", name: null, legacyAccountId: null };
}

function reel(query: string): RawReel {
  return {
    id: `r-${query}`,
    platform: "instagram",
    account: "creator",
    followers: 1000,
    url: `https://www.instagram.com/p/${encodeURIComponent(query)}/`,
    caption: "a real post",
    postedAt: new Date().toISOString(),
    views: 5000,
    likes: 50,
    comments: 2,
  };
}

function research(query: string, spent: number): NicheResearch {
  return {
    query,
    fetchedAt: new Date().toISOString(),
    cached: spent === 0,
    credits: { spent, calls: spent ? 1 : 0, remaining: null },
    accounts: [],
    nicheMedianViews: 5000,
    reels: 1,
    totalReels: 1,
    own: null,
    hashtags: [],
    errors: [],
    payload: [reel(query)],
    language: { wanted: null, basis: "none", kept: 1, dropped: 0, by: {} },
  };
}

interface LedgerRow {
  delta: number;
  reason: string;
  ref: string | null;
}

async function ledgerRows(q: Queryable, userId: string): Promise<LedgerRow[]> {
  const { rows } = await q.query<LedgerRow>(
    "SELECT delta, reason, ref FROM credit_ledger WHERE user_id = $1 ORDER BY id",
    [userId],
  );
  return rows;
}

function deps(
  userId: string | null,
  overrides: Partial<RecommendPullsDeps> = {},
): { deps: RecommendPullsDeps; calls: () => number } {
  let calls = 0;
  const base: RecommendPullsDeps = {
    researchNiche: async (opts) => {
      calls += 1;
      return research(opts.query, 1);
    },
    isCached: async () => false,
    now: T0,
    ...overrides,
  };
  return { deps: base, calls: () => calls };
}

const candidates = [
  { query: "telugu cooking", interest: "food" },
  { query: "home workout", interest: "fitness" },
];

test("anonymous → 401 always, even when every room is cached, and no vendor call", async () => {
  await withFreshDb(async (_q, _userId) => {
    const { deps: d, calls } = deps(null, { isCached: async () => true });
    const out = await runRecommendPulls(
      { candidates, fitWords: [], user: null },
      d,
    );
    assert.deepEqual(out, { status: 401, error: "Sign in to read a new one" });
    assert.equal(calls(), 0);
  });
});

test("signed in with insufficient credits → 402 and no vendor call", async () => {
  await withFreshDb(async (_q, userId) => {
    await spend(userId, COSTS.dailyFree, "test", undefined, T0);
    const { deps: d, calls } = deps(userId);
    const out = await runRecommendPulls(
      { candidates, fitWords: [], user: sessionUser(userId) },
      d,
    );
    assert.equal(out.status, 402);
    assert.equal(calls(), 0);
  });
});

test("a fresh room charges exactly once; a cached one is free", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      researchNiche: async (opts) => {
        recordDirectSpend("apify", { usd: 0.02, units: 1 });
        return research(opts.query, 1);
      },
    });
    const out = await runRecommendPulls(
      { candidates: [candidates[0]!], fitWords: [], user: sessionUser(userId) },
      d,
    );
    assert.equal(out.status, 200);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: "telugu cooking" },
    ]);
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.niche);
  });
});

test("a pull that throws is refunded exactly once", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      researchNiche: async () => {
        recordDirectSpend("apify", { usd: 0.02, units: 1 });
        throw new Error("vendor went away");
      },
    });
    const out = await runRecommendPulls(
      { candidates: [candidates[0]!], fitWords: [], user: sessionUser(userId) },
      d,
    );
    assert.equal(out.status, 400);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: "telugu cooking" },
      { delta: COSTS.niche, reason: "refund", ref: "refund:1" },
    ]);
  });
});

test("a pull that measured zero spend is refunded", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      researchNiche: async (opts) => research(opts.query, 0),
    });
    const out = await runRecommendPulls(
      { candidates: [candidates[0]!], fitWords: [], user: sessionUser(userId) },
      d,
    );
    assert.equal(out.status, 200);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: "telugu cooking" },
      { delta: COSTS.niche, reason: "refund", ref: "refund:1" },
    ]);
  });
});

test("a 402 mid-loop keeps the rooms already paid for and says why", async () => {
  await withFreshDb(async (q, userId) => {
    // Leave exactly one niche charge in the pool, then let the first pull spend
    // real money so its charge is kept. The second room is refused for credits.
    await spend(userId, COSTS.dailyFree - COSTS.niche, "test", undefined, T0);
    let pulls = 0;
    const { deps: d } = deps(userId, {
      researchNiche: async (opts) => {
        pulls += 1;
        recordDirectSpend("apify", { usd: 0.02, units: 1 });
        return research(opts.query, 1);
      },
    });
    const out = await runRecommendPulls(
      { candidates, fitWords: [], user: sessionUser(userId) },
      d,
    );
    assert.equal(out.status, 200);
    if (out.status !== 200) throw new Error("unreachable");
    assert.equal(out.ranked.length, 1);
    assert.match(out.note ?? "", /Showing the rooms already read/);
    assert.equal(pulls, 1);
    const paid = (await ledgerRows(q, userId)).filter((r) => r.reason !== "test");
    assert.deepEqual(paid, [
      { delta: -COSTS.niche, reason: "niche", ref: "telugu cooking" },
    ]);
  });
});

test.after(() => {
  resetDbForTests();
});
