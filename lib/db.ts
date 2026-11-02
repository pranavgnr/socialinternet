// One shared Postgres pool for the app; test overrides for the harness.
import { Pool } from "pg";

export type Queryable = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

let pool: Pool | null = null;
let testClient: Queryable | null = null;

// The shared pg pool, created lazily from DATABASE_URL.
export function db(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url });
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
