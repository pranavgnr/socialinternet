// Daily credit ledger. The free pool is granted lazily per user per IST day
// and never accumulates: only spends and refunds are stored as ledger rows,
// and a day's balance is always computed as dailyFree + sum(delta) for that
// day. Refunds cancel one specific spend entry, once.
//
// Concurrency: every write runs in an explicit transaction whose FIRST
// statement takes `pg_advisory_xact_lock(hashtext(userId))` — an exclusive,
// transaction-scoped lock per user. A second writer for the same user waits
// for the lock; because every statement afterwards takes a fresh
// (READ COMMITTED) snapshot, it re-reads the ledger only after the earlier
// transaction committed, so read-modify-write is serialised per user and the
// balance can never go negative. The lock releases itself at COMMIT/ROLLBACK.
import { currentDb, withClient, type Queryable } from "./db";
import { COSTS } from "./costs";

// YYYY-MM-DD in Asia/Kolkata. en-CA formats leading-zero numerics in that
// exact order, so it reads straight out of the formatter.
export function istDay(now?: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now ?? new Date());
}

// --- transaction plumbing ------------------------------------------------ ---
// Under tests lib/db's setDbForTests hands EVERY withClient caller the same
// singleton (the one PGlite), all sharing one connection: there, statements
// from interleaved transactions would mix (one writer's COMMIT would commit
// another's BEGIN), so transaction bodies for that shared client queue on a
// chain. With the real pool each withClient() caller checks out its own
// connection — detected by the wrapper object it receives differing from
// currentDb() — so nothing queues and the advisory lock above does the
// per-user serialisation, including across separate app processes.
const sharedChains = new WeakMap<object, Promise<unknown>>();

function queued<T>(q: Queryable, fn: () => Promise<T>): Promise<T> {
  if (q !== currentDb()) return fn(); // own connection: no queue needed
  const next = (sharedChains.get(q) ?? Promise.resolve()).then(fn, fn);
  sharedChains.set(q, next.then(() => undefined, () => undefined));
  return next;
}

async function transact<T>(
  q: Queryable,
  fn: (tx: Queryable) => Promise<T>
): Promise<T> {
  return queued(q, async () => {
    await q.query("BEGIN");
    try {
      const out = await fn(q);
      await q.query("COMMIT");
      return out;
    } catch (err) {
      await q.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });
}

// The per-user write lock. Only xact-scope (pg_advisory_xact_lock), never a
// session lock: the transaction ends it even on an exception path.
async function lockUser(q: Queryable, userId: string): Promise<void> {
  await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [userId]);
}

export type SpendResult =
  | { ok: true; balance: number; entryId: number }
  | { ok: false; balance: number };

// Appends a -amount row for today (IST) if the day's balance allows it.
// Atomic per user: exactly one of two concurrent spends of the last credits
// succeeds, and the balance never goes negative. Returns the refreshed
// balance either way, plus the ledger entry id on success.
export async function spend(
  userId: string,
  amount: number,
  reason: string,
  ref?: string,
  now?: Date
): Promise<SpendResult> {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(
      `spend: amount must be a non-negative integer, got ${amount}`
    );
  }
  if (amount === 0) {
    return { ok: true, balance: await balance(userId, now), entryId: 0 };
  }
  const day = istDay(now);
  return withClient((q) =>
    transact(q, async (tx) => {
      await lockUser(tx, userId);

      // Fresh snapshot, taken after the lock was granted.
      const { rows } = await tx.query<{ s: number }>(
        "SELECT COALESCE(SUM(delta), 0)::int AS s FROM credit_ledger" +
          " WHERE user_id = $1 AND day = $2",
        [userId, day]
      );
      const held = COSTS.dailyFree + Number(rows[0]?.s ?? 0);
      if (held < amount) return { ok: false, balance: held };

      const ins = await tx.query<{ id: string | number }>(
        "INSERT INTO credit_ledger (user_id, day, delta, reason, ref, created_at)" +
          " VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))" +
          " RETURNING id",
        [userId, day, -amount, reason, ref ?? null, now ?? null]
      );
      return {
        ok: true,
        balance: held - amount,
        entryId: Number(ins.rows[0]!.id),
      };
    })
  );
}

// Today's free pool minus today's spend. The lazy pool means a day with no
// rows is already at full balance — no grant row is ever written.
export async function balance(userId: string, now?: Date): Promise<number> {
  const { rows } = await currentDb().query<{ s: number }>(
    "SELECT COALESCE(SUM(delta), 0)::int AS s FROM credit_ledger" +
      " WHERE user_id = $1 AND day = $2",
    [userId, istDay(now)]
  );
  return COSTS.dailyFree + Number(rows[0]?.s ?? 0);
}

// Appends one positive compensating row for the spend entry, restoring the
// balance of the day it was spent on. Idempotent: the guard is evaluated
// inside the SAME locked transaction, so two refunds racing for the same
// entry — even across app processes — insert exactly one row; the second
// caller sees the first's committed row and writes nothing.
export async function refund(entryId: number): Promise<void> {
  const { rows } = await currentDb().query<{
    user_id: string;
    day: string;
    delta: number;
  }>(
    "SELECT user_id, day::text AS day, delta FROM credit_ledger WHERE id = $1",
    [entryId]
  );
  const entry = rows[0];
  if (!entry) throw new Error(`refund: no credit_ledger entry ${entryId}`);

  const mark = `refund:${entryId}`;
  await withClient((q) =>
    transact(q, async (tx) => {
      await lockUser(tx, entry.user_id);

      await tx.query(
        "INSERT INTO credit_ledger (user_id, day, delta, reason, ref, created_at)" +
          " SELECT user_id, day, -delta, 'refund', $2, now()" +
          " FROM credit_ledger" +
          " WHERE id = $1 AND delta <> 0" +
          " AND NOT EXISTS (" +
          "   SELECT 1 FROM credit_ledger c" +
          "   WHERE c.reason = 'refund' AND c.ref = $2" +
          " )",
        [entryId, mark]
      );
    })
  );
}
