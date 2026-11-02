// CLI entry for `npm run migrate`: applies db/migrations to the Postgres
// pointed at by DATABASE_URL. Safe to re-run; prints what it applied.
import { db } from "../lib/db";
import { migrate } from "../lib/migrate";
import type { Queryable } from "../lib/db";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("migrate: DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = db();
  const client = await pool.connect();
  try {
    // One connection for the whole run, so the BEGIN/COMMIT inside migrate
    // actually brackets its statements despite using a Pool underneath.
    const q: Queryable = {
      async query<T>(sql: string, params?: unknown[]) {
        const res = await client.query<T>(sql, params as never[]);
        return { rows: res.rows };
      },
    };
    const applied = await migrate(q);
    if (applied.length === 0) {
      console.log("migrate: up to date");
    } else {
      for (const name of applied) console.log(`migrate: applied ${name}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate: failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
