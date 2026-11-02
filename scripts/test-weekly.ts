// Route-level tests for POST /api/weekly without Next. Real gate and settle, so
// the handle charge and its refund are exercised on PGlite; runWeekly is a spy.
//   npm run test:file -- test-weekly
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/migrate";
import { setDbForTests, resetDbForTests, type Queryable } from "../lib/db";
import { balance, spend } from "../lib/credits";
import { COSTS } from "../lib/costs";
import { recordDirectSpend } from "../lib/providers";
import { runWeeklyRequest, type WeeklyRequestDeps } from "../lib/weeklyRequest";
import type { SessionUser } from "../lib/auth";
import type { GrowthPlan } from "../lib/types";
import type { Store } from "../lib/store";
import type { WeeklyDigest, WeeklyRun } from "../lib/weekly";

const T0 = new Date("2026-11-02T10:00:00Z");
const HANDLE = "natgeotravel";

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

function digest(): WeeklyDigest {
  return { weekOf: "2026-11-02", handle: HANDLE } as WeeklyDigest;
}

function store(hasPlan = true): Pick<Store, "getPlan"> {
  return {
    getPlan: async () =>
      (hasPlan ? { handle: HANDLE } : null) as GrowthPlan | null,
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
  overrides: Partial<WeeklyRequestDeps> = {},
): { deps: WeeklyRequestDeps; calls: () => number } {
  let calls = 0;
  const base: WeeklyRequestDeps = {
    store: store(),
    user: userId ? sessionUser(userId) : null,
    runWeekly: async () => {
      calls += 1;
      return { digest: digest(), db: {} as Store } as WeeklyRun;
    },
    now: T0,
    ...overrides,
  };
  return { deps: base, calls: () => calls };
}

test("anonymous → 401 and the vendor is never called", async () => {
  await withFreshDb(async (_q, _userId) => {
    const { deps: d, calls } = deps(null);
    const out = await runWeeklyRequest(d);
    assert.deepEqual(out, { status: 401, error: "Sign in to refresh this week." });
    assert.equal(calls(), 0);
  });
});

test("signed in with insufficient credits → 402 and no vendor call", async () => {
  await withFreshDb(async (_q, userId) => {
    await spend(userId, COSTS.dailyFree, "test", undefined, T0);
    const { deps: d, calls } = deps(userId);
    const out = await runWeeklyRequest(d);
    assert.equal(out.status, 402);
    assert.equal(calls(), 0);
  });
});

test("a missing plan is refused before anything is charged", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d, calls } = deps(userId, { store: store(false) });
    const out = await runWeeklyRequest(d);
    assert.equal(out.status, 400);
    assert.equal(calls(), 0);
    assert.deepEqual(await ledgerRows(q, userId), []);
  });
});

test("signed in and successful charges the handle price exactly once", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      runWeekly: async () => {
        recordDirectSpend("apify", { usd: 0.02, units: 1 });
        return { digest: digest(), db: {} as Store } as WeeklyRun;
      },
    });
    const out = await runWeeklyRequest(d);
    assert.equal(out.status, 200);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.handle, reason: "handle", ref: HANDLE },
    ]);
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.handle);
  });
});

test("a run that throws is refunded exactly once", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      runWeekly: async () => {
        recordDirectSpend("apify", { usd: 0.02, units: 1 });
        throw new Error("vendor went away");
      },
    });
    await assert.rejects(() => runWeeklyRequest(d), /vendor went away/);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.handle, reason: "handle", ref: HANDLE },
      { delta: COSTS.handle, reason: "refund", ref: "refund:1" },
    ]);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("a run that measured zero spend is refunded", async () => {
  await withFreshDb(async (q, userId) => {
    const { deps: d } = deps(userId, {
      runWeekly: async () => ({ digest: digest(), db: {} as Store }) as WeeklyRun,
    });
    const out = await runWeeklyRequest(d);
    assert.equal(out.status, 200);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.handle, reason: "handle", ref: HANDLE },
      { delta: COSTS.handle, reason: "refund", ref: "refund:1" },
    ]);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test.after(() => {
  resetDbForTests();
});
