// Credit ledger tests: runs entirely on in-memory PGlite, no DATABASE_URL.
//   npm run test:file -- test-credits
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/migrate";
import { closeDb, setDbForTests, resetDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import { istDay, balance, spend, refund } from "../lib/credits";
import { COSTS } from "../lib/costs";

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

// Fixed wall-clock moments: 2026-11-02T18:29Z is 23:59 IST on 2026-11-02,
// 18:31Z is 00:01 IST on 2026-11-03. Middays are safely inside each day.
const T0 = new Date("2026-11-02T10:00:00Z"); // IST 2026-11-02
const T1 = new Date("2026-11-03T10:00:00Z"); // IST 2026-11-03

// Fresh PGlite with the schema applied and one user inserted; setDbForTests
// routes every credit-ledger call in the block to it. The PGlite is closed
// afterwards, and the shared test client is cleared so later tests start clean.
async function withFreshDb<T>(
  fn: (q: Queryable, userId: string) => Promise<T>
): Promise<T> {
  const pg = new PGlite();
  const q = asQueryable(pg);
  setDbForTests(q);
  try {
    await migrate(q);
    const userId = randomUUID();
    await q.query(
      "INSERT INTO users (id, email, created_at) VALUES ($1, $2, now())",
      [userId, "creator@example.com"]
    );
    return await fn(q, userId);
  } finally {
    await pg.close();
  }
}

test("istDay maps late UTC moments across the IST midnight", () => {
  assert.equal(istDay(new Date("2026-11-02T18:29:00Z")), "2026-11-02");
  assert.equal(istDay(new Date("2026-11-02T18:31:00Z")), "2026-11-03");
  // A middays case, both formats of input agree with the fixed points.
  assert.equal(istDay(T0), "2026-11-02");
  assert.equal(istDay(T1), "2026-11-03");
});

test("a fresh user has the full daily free pool", async () => {
  await withFreshDb(async (_q, userId) => {
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
    assert.equal(COSTS.dailyFree, 15); // the plan's V1 default
  });
});

test("spending drains the pool and refuses to go negative", async () => {
  await withFreshDb(async (q, userId) => {
    const first = await spend(userId, 6, "niche", "niche:food", T0);
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("unreachable"); // narrowing for tsc
    assert.equal(first.balance, 9);

    const second = await spend(userId, 6, "niche", "niche:fitness", T0);
    if (!second.ok) throw new Error("second spend should have succeeded");
    assert.equal(second.balance, 3);

    const third = await spend(userId, 6, "handle", "handle:@who", T0);
    assert.deepEqual({ ok: third.ok, balance: third.balance }, {
      ok: false,
      balance: 3,
    });

    const { rows } = await q.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM credit_ledger WHERE user_id = $1",
      [userId]
    );
    assert.equal(rows[0]!.n, 2); // the refused spend wrote nothing
    assert.equal(await balance(userId, T0), 3);
  });
});

test("20 parallel 1-credit spends against a pool of 15 yield exactly 15 ok", async () => {
  await withFreshDb(async (q, userId) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        spend(userId, 1, "chat", `msg:${i}`, T0)
      )
    );
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    assert.equal(ok.length, 15);
    assert.equal(failed.length, 5);

    // Every successful spend saw a strictly decreasing balance, so no two
    // writers ever read the same starting balance.
    assert.deepEqual(
      ok.map((r) => (r.ok ? r.balance : -1)).sort((a, b) => b - a),
      [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
    );
    // The refusals all saw the drained pool, never a negative balance.
    for (const r of failed) assert.equal(r.balance, 0);

    assert.equal(await balance(userId, T0), 0);
    const { rows } = await q.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM credit_ledger WHERE user_id = $1 AND delta = -1",
      [userId]
    );
    assert.equal(rows[0]!.n, 15); // exactly fifteen ledger entries
  });
});

test("refund restores the spent amount; a second refund changes nothing", async () => {
  await withFreshDb(async (q, userId) => {
    const spent = await spend(userId, 6, "niche", "niche:food", T0);
    if (!spent.ok) throw new Error("spend should have succeeded");
    assert.equal(await balance(userId, T0), 9);

    await refund(spent.entryId);
    assert.equal(await balance(userId, T0), 15);

    await refund(spent.entryId); // idempotent: a no-op
    assert.equal(await balance(userId, T0), 15);

    const { rows } = await q.query<{ ref: string; delta: number }>(
      "SELECT ref, delta FROM credit_ledger WHERE reason = 'refund' AND ref = $1",
      [`refund:${spent.entryId}`]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.delta, 6);
  });
});

test("a concurrent double refund appends exactly one compensating row", async () => {
  await withFreshDb(async (q, userId) => {
    const spent = await spend(userId, 6, "niche", "niche:food", T0);
    if (!spent.ok) throw new Error("spend should have succeeded");

    await Promise.all([refund(spent.entryId), refund(spent.entryId)]);

    assert.equal(await balance(userId, T0), 15);
    const { rows } = await q.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM credit_ledger WHERE reason = 'refund' AND ref = $1",
      [`refund:${spent.entryId}`]
    );
    assert.equal(rows[0]!.n, 1);
  });
});

test("the next IST day grants pool again — the pool never accumulates", async () => {
  await withFreshDb(async (_q, userId) => {
    await spend(userId, 6, "niche", "niche:food", T0);
    await spend(userId, 6, "niche", "niche:fitness", T0);
    assert.equal(await balance(userId, T0), 3);
    // Yesterday's spend does not carry over: the pool is fully granted again.
    assert.equal(await balance(userId, T1), COSTS.dailyFree);
    // Spending on the new day starts a new day's ledger row.
    const r = await spend(userId, 1, "chat", "msg:2", T1);
    if (!r.ok) throw new Error("new-day spend should have succeeded");
    assert.equal(r.balance, COSTS.dailyFree - 1);
  });
});

test("refund throws for an entry that does not exist", async () => {
  await withFreshDb(async () => {
    await assert.rejects(() => refund(424242), /no credit_ledger entry/);
  });
});

test("spend rejects a negative or fractional amount", async () => {
  await withFreshDb(async (_q, userId) => {
    await assert.rejects(() => spend(userId, -1, "chat", undefined, T0), /amount/);
    await assert.rejects(() => spend(userId, 1.5, "chat", undefined, T0), /amount/);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("lifetimeUsd survives a reset, so a measured settle cannot lose spend", async () => {
  // `researchNiche` resets the per-run ledger before every fresh pull. A route
  // that snapshots the ledger before its work and settles after must still see
  // the money its own call spent, even when another pull reset `usd` in between.
  const { creditLedger, recordDirectSpend, resetCreditLedger } = await import(
    "../lib/providers"
  );
  const usdBefore = creditLedger().lifetimeUsd;
  const unitsBefore = creditLedger().lifetimeSpent;

  recordDirectSpend("apify", { usd: 0.02, units: 3 });
  resetCreditLedger();

  const usdDelta = creditLedger().lifetimeUsd - usdBefore;
  const unitsDelta = creditLedger().lifetimeSpent - unitsBefore;
  assert.ok(Math.abs(usdDelta - 0.02) < 1e-9, `expected $0.02, got ${usdDelta}`);
  assert.equal(unitsDelta, 3);
  // The per-run counters still reset, so the budget ceiling is unchanged.
  assert.equal(creditLedger().usd, 0);
  assert.equal(creditLedger().spent, 0);
});

// Needs no database: confirms closeDb also resolves after the pool-free run.
test("closeDb is a no-op in this suite", async () => {
  await closeDb();
});

test.after(() => {
  resetDbForTests();
});
