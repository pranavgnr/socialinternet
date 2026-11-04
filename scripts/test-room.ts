// Route-level tests for POST /api/room without Next. Real gate and settle, so
// the credit rules are exercised end-to-end on PGlite; the vendor pull is a spy.
//   npm run test:file -- test-room
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/migrate";
import { setDbForTests, resetDbForTests, type Queryable } from "../lib/db";
import { balance, spend } from "../lib/credits";
import { COSTS } from "../lib/costs";
import { recordDirectSpend } from "../lib/providers";
import { runRoomRequest, type RoomRequestDeps } from "../lib/roomRequest";
import type { SessionUser } from "../lib/auth";
import type { NicheResearch } from "../lib/niche";
import type { RoomPlan } from "../lib/newcomer";
import type { Profile, RawReel } from "../lib/types";
import type { Store } from "../lib/store";

const T0 = new Date("2026-11-02T10:00:00Z");
const QUERY = "telugu cooking";

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

function reel(): RawReel {
  return {
    id: "r1",
    platform: "instagram",
    account: "creator",
    followers: 1000,
    url: "https://www.instagram.com/p/r1/",
    caption: "a real post",
    postedAt: new Date().toISOString(),
    views: 5000,
    likes: 50,
    comments: 2,
  };
}

function research(spent: number): NicheResearch {
  return {
    query: QUERY,
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
    payload: [reel()],
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
  overrides: Partial<RoomRequestDeps> = {},
): { deps: RoomRequestDeps; calls: () => number } {
  let calls = 0;
  const base: RoomRequestDeps = {
    store: {
      getProfile: async () => null,
      saveRoom: async () => {},
      saveProfile: async () => {},
    } as unknown as Store,
    user: userId ? sessionUser(userId) : null,
    researchNiche: async () => {
      calls += 1;
      return research(1);
    },
    buildRoomPlan: () => ({ query: QUERY }) as RoomPlan,
    roomProfile: () => ({}) as Profile,
    runPipeline: async () => ({}),
    scheduleAfter: () => {},
    logError: () => {},
    isCached: async () => false,
    now: T0,
    ...overrides,
  };
  return { deps: base, calls: () => calls };
}

test("anonymous + uncached → 401 and the vendor is never called", async () => {
  await withFreshDb(async (_q, userId) => {
    const { deps: d, calls } = deps(null);
    const out = await runRoomRequest({ query: QUERY }, d);
    assert.deepEqual(out, { status: 401, error: "Sign in to read a new one" });
    assert.equal(calls(), 0);
  });
});

test("anonymous + cached → free for anyone, no ledger row", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d, calls } = deps(null, {
      isCached: async () => true,
      researchNiche: async () => research(0),
    });
    const out = await runRoomRequest({ query: QUERY }, d);
    assert.equal(out.status, 200);
    assert.equal(calls(), 0);
    assert.deepEqual(await ledgerRows(q, userId), []);
  });
});

test("signed in with insufficient credits → 402 and no vendor call", async () => {
  await withFreshDb(async (_q, userId) => {
    await spend(userId, COSTS.dailyFree, "test", undefined, T0);
    const { deps: d, calls } = deps(userId);
    const out = await runRoomRequest({ query: QUERY }, d);
    assert.equal(out.status, 402);
    assert.equal(calls(), 0);
  });
});

test("signed in and fresh charges exactly once", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      researchNiche: async () => {
        recordDirectSpend("apify", { usd: 0.02, units: 1 });
        return research(1);
      },
    });
    const out = await runRoomRequest({ query: QUERY }, d);
    assert.equal(out.status, 200);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: QUERY },
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
    await assert.rejects(() => runRoomRequest({ query: QUERY }, d), /vendor went away/);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: QUERY },
      { delta: COSTS.niche, reason: "refund", ref: `refund:1` },
    ]);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("a pull that measured zero spend is refunded", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, { researchNiche: async () => research(0) });
    const out = await runRoomRequest({ query: QUERY }, d);
    assert.equal(out.status, 200);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: QUERY },
      { delta: COSTS.niche, reason: "refund", ref: `refund:1` },
    ]);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test.after(() => {
  resetDbForTests();
});
