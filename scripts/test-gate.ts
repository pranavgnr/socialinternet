// Credit-gate tests: runs entirely on in-memory PGlite, no DATABASE_URL and no
// Next request context — gate's isCached and getUser are injected.
//   npm run test:file -- test-gate
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/migrate";
import { closeDb, setDbForTests, resetDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import { balance, spend } from "../lib/credits";
import { COSTS } from "../lib/costs";
import { gate, settle, settleAfter, type GateOptions } from "../lib/gate";
import type { SessionUser } from "../lib/auth";

// Fixed wall-clock moment: 2026-11-02T10:00Z is 15:30 IST on 2026-11-02, so the
// pool resets at midnight IST on 2026-11-03 — 8.5 hours away.
const T0 = new Date("2026-11-02T10:00:00Z");

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

function sessionUser(id: string): SessionUser {
  return { id, email: "creator@example.com", name: null, legacyAccountId: null };
}

// Runs gate with every Next-facing pieces injected, so no request machinery.
type GateVerdict = Awaited<ReturnType<typeof gate>>;

function g(userId: string | null, opts: Partial<GateOptions> = {}): Promise<GateVerdict> {
  return gate("niche", {
    getUser: async () => (userId ? sessionUser(userId) : null),
    isCached: async () => false,
    now: T0,
    ...opts,
  } as GateOptions);
}

async function ledgerRows(q: Queryable, userId: string): Promise<{ delta: number; reason: string; ref: string | null }[]> {
  const { rows } = await q.query<{ delta: number; reason: string; ref: string | null }>(
    "SELECT delta, reason, ref FROM credit_ledger WHERE user_id = $1 ORDER BY id",
    [userId]
  );
  return rows;
}

test("a cached read is free for anyone — nothing is charged and no ledger row is written", async () => {
  await withFreshDb(async (q, userId) => {
    const res = await g(userId, { isCached: async () => true });
    assert.deepEqual(res, { ok: true, charged: 0 });
    if (res.ok) assert.equal(res.entryId, undefined); // never handed to settle()/refund()
    assert.deepEqual(await ledgerRows(q, userId), []);
  });
});

test("anonymous and not cached asks to sign in at 401", async () => {
  await withFreshDb(async (q, userId) => {
    const res = await g(null);
    assert.deepEqual(res, { ok: false, status: 401, message: "Sign in to read a new one" });
    assert.deepEqual(await ledgerRows(q, userId), []); // no user row charged anyway
  });
});

test("signed in and fresh charges the niche price and leaves 9 of 15", async () => {
  await withFreshDb(async (q, userId) => {
    const res = await g(userId, { key: "telugu cooking" });
    assert.ok(res.ok, "gate should have charged");
    if (!res.ok) throw new Error("unreachable"); // narrowing for tsc
    assert.equal(res.charged, COSTS.niche);
    assert.ok(res.entryId !== undefined && res.entryId !== 0, "a real spend has a ledger entry id");
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.niche);
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -COSTS.niche, reason: "niche", ref: "telugu cooking" },
    ]);
  });
});

test("a fresh handle costs the handle price", async () => {
  await withFreshDb(async (_q, userId) => {
    const res = await gate("handle", {
      key: "natgeotravel",
      getUser: async () => sessionUser(userId),
      isCached: async () => false,
      now: T0,
    });
    assert.ok(res.ok);
    if (res.ok) assert.equal(res.charged, COSTS.handle);
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.handle);
  });
});

test("a handle plan is never cache-free, whoever is asking", async () => {
  await withFreshDb(async (q, userId) => {
    // The disk says cached; a handle plan is not free on that alone.
    const cached = { isCached: async () => true, key: "natgeotravel", now: T0 };

    // A stranger gets the sign-in refusal even before cache feels relevant.
    const anon = await gate("handle", { ...cached, getUser: async () => null });
    assert.deepEqual(anon, { ok: false, status: 401, message: "Sign in to read a new one" });
    assert.deepEqual(await ledgerRows(q, userId), []);

    // Signed in, the same cached handle still charges: the run buys vendor
    // work beyond the feed, so the cache never makes it free up front.
    const signed = await gate("handle", { ...cached, getUser: async () => sessionUser(userId) });
    assert.ok(signed.ok);
    if (signed.ok) assert.equal(signed.charged, COSTS.handle);
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.handle);
  });
});

test("(review) a run the ledger measured as free refunds the plan charge", async () => {
  await withFreshDb(async (_q, userId) => {
    const verdict = await gate("handle", {
      key: "natgeotravel",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    // The measured vendor dollars across the run: zero — everything back.
    await settleAfter(verdict.entryId, async () => "plan built", () => 0);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("(review) a run the result calls free but the ledger measured costly keeps its charge", async () => {
  await withFreshDb(async (_q, userId) => {
    const verdict = await gate("handle", {
      key: "natgeotravel",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    // The regression the review caught: the cohort result's own unit counter
    // reads 0 after a cache hit and misses half the pulls, so the refund may
    // only consult the measured vendor money — 2.49 cents means kept.
    await settleAfter(
      verdict.entryId,
      async () => ({ credits: { spent: 0 } }),
      () => 0.0249
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.handle);
  });
});

test("(review) a thrown run refunds exactly once", async () => {
  await withFreshDb(async (q, userId) => {
    const verdict = await gate("handle", {
      key: "natgeotravel",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    await assert.rejects(
      () => settleAfter(verdict.entryId, async () => {
        throw new Error("vendor died");
      }, () => 9),
      /vendor died/
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree);

    const { rows } = await q.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM credit_ledger WHERE reason = 'refund' AND ref = $1",
      [`refund:${verdict.entryId}`]
    );
    assert.equal(rows[0]!.n, 1); // once, not twice
  });
});

test("(review) a refund that cannot be written breaks nothing that finished", async () => {
  await withFreshDb(async (_q, userId) => {
    // An entry id that never existed makes settle throw inside settleQuietly;
    // the finished result must still ride out, not be turned into a failure.
    const res = await settleAfter(999_999, async () => ({ ok: true }), () => 0);
    assert.deepEqual(res, { ok: true });
    // Same on the thrown path: the original error, not the settle failure.
    await assert.rejects(
      () => settleAfter(999_999, async () => {
        throw new Error("vendor died");
      }, () => 0),
      /vendor died/
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree); // never touched
  });
});

test("insufficient balance refuses at 402 with the reset time and the balance", async () => {
  await withFreshDb(async (q, userId) => {
    const first = await spend(userId, 6, "niche", "a", T0);
    if (!first.ok) throw new Error("first spend should have succeeded");
    const second = await spend(userId, 6, "niche", "b", T0);
    if (!second.ok) throw new Error("second spend should have succeeded");
    assert.equal(await balance(userId, T0), 3);

    const res = await g(userId, { key: "telugu comedy" });
    assert.equal(res.ok, false, "a drained pool must refuse");
    if (res.ok) throw new Error("unreachable");
    assert.equal(res.status, 402);
    assert.match(res.message, /3 left/); // the balance, so the number is not a surprise
    assert.match(res.message, /tomorrow at 12:00 am IST/); // when the pool refills
    assert.match(res.message, /9 hours/); // 15:30 IST now, 8.5 h to the reset

    // A refusal writes nothing: the balance stays exactly as it was.
    assert.deepEqual(await ledgerRows(q, userId), [
      { delta: -6, reason: "niche", ref: "a" },
      { delta: -6, reason: "niche", ref: "b" },
    ]);
  });
});

test("force is never served from the cache, whoever is asking", async () => {
  await withFreshDb(async (_q, userId) => {
    const res = await g(userId, { force: true, isCached: async () => true });
    assert.ok(res.ok);
    if (res.ok) assert.equal(res.charged, COSTS.niche);
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.niche);
  });
});

test("settle(entryId, 0) refunds the full charge; settle(entryId, 3) keeps it", async () => {
  await withFreshDb(async (_q, userId) => {
    const first = await g(userId, { key: "room one" });
    if (!first.ok) throw new Error("first gate should have charged");

    // The pull turned out to cost the vendor nothing — every credit back.
    await settle(first.entryId, 0);
    assert.equal(await balance(userId, T0), COSTS.dailyFree);

    // A second fresh read, this time the pull cost vendor credits — kept.
    const second = await g(userId, { key: "room two" });
    if (!second.ok) throw new Error("second gate should have charged");
    await settle(second.entryId, 3);
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.niche);
  });
});

test("settle with no entry (a cached read charged 0) changes nothing", async () => {
  await withFreshDb(async (_q, userId) => {
    const cached = await g(null, { isCached: async () => true });
    if (!cached.ok) throw new Error("cached gate should pass");
    await settle(cached.entryId, 0); // undefined entry, must not touch the ledger
    await settle(0, 0); // spend(…, 0) hands back entryId 0 and writes no row
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("settleAfter refunds a promise that throws, and settles a kept spend alone", async () => {
  await withFreshDb(async (_q, userId) => {
    const charged = await g(userId, { key: "room three" });
    if (!charged.ok) throw new Error("gate should have charged");

    // A pull that dies after the charge refunds every charged credit.
    await assert.rejects(
      () => settleAfter(charged.entryId, async () => {
        throw new Error("vendor died");
      }, () => 99),
      /vendor died/
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree);

    // A second fresh read keeps its charge at the vendor's real price.
    const second = await g(userId, { key: "room four" });
    if (!second.ok) throw new Error("second gate should have charged");
    const kept = await settleAfter(second.entryId, async () => "done", () => 3);
    assert.equal(kept, "done");
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.niche);
  });
});

test("a plan whose only vendor activity was a billed 404 is not refunded", async () => {
  await withFreshDb(async (q, userId) => {
    const keys = [
      "HIKERAPI_KEY",
      "APIFY_TOKEN",
      "SOCIALCRAWL_API_KEY",
      "SCRAPECREATORS_API_KEY",
      "YOUTUBE_WEB",
      "DATA_PROVIDER",
    ] as const;
    const snap = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.HIKERAPI_KEY = "test-hiker";
    delete process.env.APIFY_TOKEN;
    delete process.env.SOCIALCRAWL_API_KEY;
    delete process.env.SCRAPECREATORS_API_KEY;
    delete process.env.YOUTUBE_WEB;
    delete process.env.DATA_PROVIDER;

    const { creditLedger, request, resetCreditLedger } = await import(
      "../lib/providers"
    );
    resetCreditLedger();
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ detail: "Not found", exc_type: "NotFoundException" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const charged = await gate("handle", {
        key: "ghost_handle",
        getUser: async () => sessionUser(userId),
        now: T0,
      });
      if (!charged.ok) throw new Error("handle gate should have charged");

      const before = creditLedger().lifetimeUsd;
      const outcome = await settleAfter(
        charged.entryId,
        async () => {
          /**
           * The plan survives a vendor miss (it may still return what the cache
           * holds); what matters here is that the attempt itself was billed and
           * therefore measured.
           */
          await request({
            path: "/instagram/profile",
            handle: "ghost_handle",
            platform: "instagram",
          }).catch(() => undefined);
          return "done";
        },
        () => creditLedger().lifetimeUsd - before,
      );

      assert.equal(outcome, "done");
      assert.equal(fetchCalls, 1, "one vendor read was attempted");
      assert.ok(
        Math.abs(creditLedger().lifetimeUsd - before - 0.02) < 1e-9,
        "the billed 404 is in the measured delta, not invisible",
      );

      const { rows } = await q.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM credit_ledger WHERE reason = 'refund' AND ref = $1",
        [`refund:${charged.entryId}`],
      );
      assert.equal(rows[0]!.n, 0, "a run that spent money keeps its charge");
      assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.handle);
    } finally {
      globalThis.fetch = realFetch;
      for (const k of keys) {
        if (snap[k] === undefined) delete process.env[k];
        else process.env[k] = snap[k];
      }
    }
  });
});

// Needs no database: confirms closeDb also resolves after the pool-free run.
test("closeDb is a no-op in this suite", async () => {
  await closeDb();
});

test.after(() => {
  resetDbForTests();
});
