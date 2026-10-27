/**
 * What does the free YouTube search actually return now?
 *
 * Prints, per query, the row count, how old the rows are, and the size
 * distribution of the accounts behind them. Those three numbers are exactly the
 * inputs to the newcomer score (freshness, headroom), so a run of this shows
 * whether the search is measuring a live room or an archive of old hits.
 *
 *   npx tsx --env-file=.env.local scripts/probe-search-window.ts "sourdough baking"
 */
import { youtubeweb } from "../lib/providers/youtubeweb";

const DAY = 86_400_000;

function median(n: number[]): number {
  if (!n.length) return NaN;
  const s = [...n].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Row {
  post?: {
    published_at?: string;
    author?: { followers?: number };
    engagement?: { views?: number };
    content?: { text?: string };
  };
}

async function main() {
  const queries = process.argv.slice(2);
  if (!queries.length) {
    console.error("usage: probe-search-window.ts <query> [query...]");
    process.exit(1);
  }

  for (const q of queries) {
    const t0 = Date.now();
    let res;
    try {
      res = await youtubeweb.searchReels(q);
    } catch (err) {
      console.log(`\n=== ${q} ===\n  FAILED: ${(err as Error).message}`);
      continue;
    }
    const items = (res.data.items ?? []) as Row[];
    const ages: number[] = [];
    const followers: number[] = [];
    const accounts = new Map<string, number>();

    for (const r of items) {
      const p = r.post ?? {};
      const at = p.published_at;
      const d = at ? (Date.now() - Date.parse(at)) / DAY : NaN;
      if (Number.isFinite(d) && d >= 0) ages.push(d);
      const f = p.author?.followers;
      if (typeof f === "number") followers.push(f);
      const a = p.author?.followers !== undefined ? "?" : "";
      void a;
      const name = (p as { author?: { username?: string } }).author?.username ?? "?";
      accounts.set(name, (accounts.get(name) ?? 0) + 1);
    }

    const small = followers.filter((f) => f < 100_000).length;
    const known = followers.length;
    console.log(`\n=== ${q} ===`);
    console.log(
      `  window=${String((res.data as { window?: string }).window)}  rows=${items.length}  ${Date.now() - t0}ms  accounts=${accounts.size}`,
    );
    console.log(
      `  dated=${ages.length}/${items.length}  medianAge=${Number.isFinite(median(ages)) ? median(ages).toFixed(1) + "d" : "none"}`,
    );
    console.log(
      `  followers known=${known}/${items.length}  under100k=${small}${known ? ` (${Math.round((100 * small) / known)}%)` : ""}`,
    );
    const sample = [...accounts.keys()].slice(0, 6).join(", ");
    console.log(`  sample: ${sample}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
