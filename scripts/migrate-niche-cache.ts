/**
 * One-off: stamp healthy niche caches with the current schema version, and
 * delete the ones whose dates were invented by the old YouTube age parser.
 *
 * The cache guard in lib/niche.ts rejects any file whose `v` is not
 * CACHE_SCHEMA. That is correct but blunt: every room on disk predates the
 * field, so a plain bump would throw away 15 good pulls along with the 7 bad
 * ones. This keeps the good ones by checking the actual property the version is
 * a proxy for — do the dates describe the videos, or the harvest clock?
 *
 * Run once:  npx tsx scripts/migrate-niche-cache.ts
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "niches");
const SCHEMA = 2;

/** Mirrors `datesLookReal` in lib/niche.ts. */
function datesLookReal(payload: { postedAt?: string }[], fetchedAt: string): boolean {
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return false;
  let dated = 0;
  let nearFetch = 0;
  for (const r of payload) {
    const at = r?.postedAt;
    if (!at) continue;
    const ms = new Date(at).getTime();
    if (!Number.isFinite(ms)) continue;
    dated++;
    if (Math.abs(ms - t) < 3600e3) nearFetch++;
  }
  if (dated < 8) return true;
  if (nearFetch === dated) return false;
  return nearFetch / dated < 0.8;
}

let kept = 0;
let dropped = 0;

for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith(".json")) continue;
  const full = path.join(DIR, file);
  let parsed: { v?: number; fetchedAt: string; payload?: { postedAt?: string }[] };
  try {
    parsed = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    console.log(`bad json, leaving alone      ${file}`);
    continue;
  }
  const ok = datesLookReal(parsed.payload ?? [], parsed.fetchedAt);
  if (!ok) {
    fs.rmSync(full);
    console.log(`dropped (invented dates)     ${file}`);
    dropped++;
    continue;
  }
  if (parsed.v !== SCHEMA) {
    fs.writeFileSync(full, JSON.stringify({ ...parsed, v: SCHEMA }), "utf8");
    console.log(`stamped v${SCHEMA}                 ${file}`);
  }
  kept++;
}

console.log(`\nkept ${kept}, dropped ${dropped} — dropped rooms re-pull for free`);
