// One shared Postgres pool for the app; test overrides for the harness.
import { Pool } from "pg";

export type Queryable = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

let pool: Pool | null = null;
let testClient: Queryable | null = null;

/**
 * How many connections the app may hold open.
 *
 * Postgres providers cap connections per plan, and every extra idle socket is
 * a connection the migration job or an operator console cannot use. Five is
 * enough for one small VPS; `DB_POOL_MAX` raises it when the plan allows.
 */
function poolMax(): number {
  const raw = process.env.DB_POOL_MAX;
  if (!raw) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

// The shared pg pool, created lazily from DATABASE_URL.
export function db(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({
      connectionString: url,
      max: poolMax(),
      // Give idle sockets back to the provider, and fail a dead database
      // quickly instead of hanging a request forever.
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

// Swap the shared client for an in-memory PGlite in tests. Everything that
// reads the database through currentDb() (instead of db() directly) then runs
// against the test instance without touching a real database.
export function setDbForTests(client: Queryable): void {
  testClient = client;
}

export function resetDbForTests(): void {
  testClient = null;
}

export function currentDb(): Queryable {
  return testClient ?? db();
}

// Closes the shared pool, if one was ever created. No-op under tests (the
// injected PGlite needs nothing) and before the first db() call. Called by
// CLI entry points so they exit instead of waiting on idle pool sockets.
export async function closeDb(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null; // allow a later db() to start a fresh pool
    await p.end();
  }
}

// Runs `fn` against one connection for the whole call. Under tests that is the
// injected PGlite directly; in the app a client is checked out of the pool and
// released afterwards (even when fn throws). Everything that must stay on a
// single connection — migrate() with its BEGIN/COMMIT, the credit ledger's
// transactions — goes through here instead of through the Pool itself, where
// each query can land on a different client.
export async function withClient<T>(
  fn: (q: Queryable) => Promise<T>
): Promise<T> {
  if (testClient) return fn(testClient);
  const client = await db().connect();
  try {
    const q: Queryable = {
      async query<S>(sql: string, params?: unknown[]): Promise<{ rows: S[] }> {
        const res = await client.query(sql, params as never[]);
        return { rows: res.rows as S[] };
      },
    };
    return await fn(q);
  } finally {
    client.release();
  }
}
