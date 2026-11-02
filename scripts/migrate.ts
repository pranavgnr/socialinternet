// CLI entry for `npm run migrate`: applies db/migrations to the Postgres
// pointed at by DATABASE_URL. Safe to re-run; prints what it applied.
import { withClient } from "../lib/db";
import { migrate } from "../lib/migrate";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("migrate: DATABASE_URL is not set");
    process.exit(1);
  }
  // withClient holds one pool client for the whole run, so the BEGIN/COMMIT
  // inside migrate actually brackets its statements.
  const applied = await withClient((q) => migrate(q));
  if (applied.length === 0) {
    console.log("migrate: up to date");
  } else {
    for (const name of applied) console.log(`migrate: applied ${name}`);
  }
}

main().catch((err) => {
  console.error("migrate: failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
