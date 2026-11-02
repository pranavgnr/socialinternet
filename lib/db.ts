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
