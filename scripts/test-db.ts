// Migration smoke test: runs entirely on in-memory PGlite, no DATABASE_URL.
//   sh scripts/run-test.sh test-db
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/migrate";
import type { Queryable } from "../lib/db";

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

const TABLES = [
  "users",
  "sessions",
  "credit_ledger",
  "chat_threads",
  "chat_messages",
  "trending_niches",
  "creator_profiles",
  "vendor_canary",
];

test("migrate applies once and is idempotent", async () => {
  const q = asQueryable(new PGlite());

  const first = await migrate(q);
  assert.deepEqual(first, ["001_init.sql"]);

  const second = await migrate(q);
  assert.deepEqual(second, []);

  const { rows } = await q.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const present = new Set(rows.map((r) => r.table_name));
  for (const table of TABLES) {
    assert.ok(present.has(table), `missing table: ${table}`);
  }
});
