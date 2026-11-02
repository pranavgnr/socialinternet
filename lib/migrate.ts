// Migration runner: applies db/migrations/*.sql in filename order and records
// each applied name in schema_migrations. Works unchanged against the pg pool
// and PGlite: files are split into single statements and run inside an
// explicit transaction, both of which pg and PGlite handle the same way.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Queryable } from "./db";

// Resolves db/migrations next to the module file (works in the tsc commonjs
// build, where __dirname is .tmp-build/lib) and falls back to the working
// directory for bundled builds where __dirname does not point at the repo.
let dirCache: string | undefined;
function migrationsDir(): string {
  if (!dirCache) {
    dirCache = path.resolve(__dirname, "..", "..", "db", "migrations");
    if (!existsSync(dirCache)) {
      dirCache = path.join(process.cwd(), "db", "migrations");
    }
  }
  return dirCache;
}

// A pg Pool exposes .connect() but no .release(), while a client has the
// opposite. migrate() runs BEGIN/COMMIT, so passing a Pool would let the
// statements land on different connections — reject rather than silently
// losing atomicity. Callers should use withClient() from lib/db.
function checkNotPool(q: Queryable): void {
  const probe = q as unknown as { connect?: unknown; release?: unknown };
  if (typeof probe.connect === "function" && typeof probe.release !== "function") {
    throw new Error(
      "migrate: pass a single connection, not a pg Pool — its queries can span connections and break the migration's transaction. Use await withClient(migrate) from lib/db instead."
    );
  }
}

// Splits a SQL file on top-level semicolons, ignoring semicolons that appear
// inside line or block comments, '…' literals, "…" identifiers and $tag$… dollar
// strings. Trims each statement and drops empties.
export function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let stmt = "";
  let mode: "sql" | "line" | "block" | "quote" | "dquote" | "dollar" = "sql";
  let tag = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (mode === "sql") {
      if (two === "--") { mode = "line"; stmt += two; i++; continue; }
      if (two === "/*") { mode = "block"; stmt += two; i++; continue; }
      if (ch === "'") { mode = "quote"; stmt += ch; continue; }
      if (ch === '"') { mode = "dquote"; stmt += ch; continue; }
      if (ch === "$") {
        const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
        if (m) { mode = "dollar"; tag = m[0]; stmt += tag; i += tag.length - 1; continue; }
      }
      if (ch === ";") {
        if (stmt.trim()) stmts.push(stmt.trim());
        stmt = "";
        continue;
      }
      stmt += ch;
    } else if (mode === "line") {
      stmt += ch;
      if (ch === "\n") mode = "sql";
    } else if (mode === "block") {
      if (two === "*/") { mode = "sql"; stmt += two; i++; continue; }
      stmt += ch;
    } else if (mode === "quote") {
      if (two === "''") { stmt += two; i++; continue; }
      if (ch === "'") mode = "sql";
      stmt += ch;
    } else if (mode === "dquote") {
      if (ch === '"') mode = "sql";
      stmt += ch;
    } else { // dollar
      if (two === tag) { mode = "sql"; stmt += two; i++; continue; }
      stmt += ch;
    }
  }
  if (stmt.trim()) stmts.push(stmt.trim());
  return stmts;
}

// Applies every unapplied migration in filename order. Each file runs inside
// one transaction: a failed migration leaves no partial DDL. Returns the
// names it applied, so a second call returns [] and callers can log what
// changed.
export async function migrate(q: Queryable): Promise<string[]> {
  checkNotPool(q);
  await q.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );

  const { rows } = await q.query<{ name: string }>(
    "SELECT name FROM schema_migrations"
  );
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(migrationsDir()))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedNow: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir(), file), "utf8");
    const statements = splitStatements(sql);
    if (statements.length === 0) {
      appliedNow.push(file); // empty file: nothing to run, still record it
      continue;
    }
    await q.query("BEGIN");
    try {
      for (const statement of statements) await q.query(statement);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await q.query("COMMIT");
    } catch (err) {
      await q.query("ROLLBACK").catch(() => {});
      throw err;
    }
    appliedNow.push(file);
  }
  return appliedNow;
}
