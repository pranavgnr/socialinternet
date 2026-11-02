// Trending-niche tests. Run entirely on fixtures + in-memory PGlite:
//   npm run test:file -- test-trending
//
// No DATABASE_URL and no data/ directory are needed. CREATORS_DATA_DIR points
// at a throwaway fixture root for the duration of this file, which is enough
// for cachedNiches() to see three rooms on "disk".
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { migrate } from "../lib/migrate";
import { resetDbForTests, setDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import { creditLedger, resetCreditLedger } from "../lib/providers";
import type { CachedNiche } from "../lib/niche";
import type { RawReel } from "../lib/types";

// --- fixtures -------------------------------------------------------------

const CWD = process.cwd();
const FIXTURE_ROOT = mkdtempSync(path.join(tmpdir(), "reel-engine-trending-"));
const NICHE_DIR = path.join(FIXTURE_ROOT, "niches");
mkdirSync(NICHE_DIR, { recursive: true });

// Read before importing lib/trending: lib/niche resolves its cache directory
// once, from this env var.
const ENV_DATA = process.env.CREATORS_DATA_DIR;
const ENV_DB = process.env.DATABASE_URL;
process.env.CREATORS_DATA_DIR = FIXTURE_ROOT;
delete process.env.DATABASE_URL;

function reel(
  query: string,
  account: string,
  views: number,
  daysAgo: number,
  i: number,
): RawReel {
  return {
    id: `${query}:${account}:${i}`,
    platform: "instagram",
    account,
    followers: 3_000,
    url: `https://instagram.com/reel/${encodeURIComponent(account)}-${i}`,
    caption: `${query} example ${i}`,
    postedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    views,
    likes: Math.round(views * 0.05),
    comments: Math.round(views * 0.004),
    hashtags: [query.split(/\s+/)[0]!],
  };
}

/** A room with `accounts` accounts, `per` reels each, one breakout each. */
function room(
  query: string,
  opts: { accounts?: number; per?: number; base?: number } = {},
): RawReel[] {
  const accounts = opts.accounts ?? 3;
  const per = opts.per ?? 4;
  const base = opts.base ?? 2_000;
  const out: RawReel[] = [];
  for (let a = 0; a < accounts; a += 1) {
    for (let i = 0; i < per; i += 1) {
      const breakout = i === per - 1;
      out.push(
        reel(
          query,
          `${query.replace(/\s+/g, "-")}-acct${a}`,
          breakout ? base * 8 : base,
          i + 2,
          a * per + i,
        ),
      );
    }
  }
  return out;
}

function cachedFixture(
  slug: string,
  query: string,
  opts: {
    accounts?: number;
    per?: number;
    base?: number;
    stale?: boolean;
    fetchedAt?: string;
  } = {},
): CachedNiche {
  const payload = room(query, opts);
  const accounts = new Set(payload.map((r) => r.account.toLowerCase())).size;
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  return {
    slug,
    query,
    fetchedAt,
    ageHours: opts.stale ? 48 : 1,
    reels: payload.length,
    accounts,
    stale: Boolean(opts.stale),
    payload,
  };
}

function writeNiche(
  slug: string,
  query: string,
  opts: { accounts?: number; per?: number; base?: number; fetchedAt?: string } = {},
): void {
  const payload = room(query, opts);
  writeFileSync(
    path.join(NICHE_DIR, `${slug}.json`),
    JSON.stringify({
      v: 2,
      fetchedAt: opts.fetchedAt ?? new Date().toISOString(),
      query,
      payload,
      errors: [],
    }),
    "utf8",
  );
}

writeNiche("home-workout", "home workout", { base: 2_500 });
writeNiche("personal-finance-for-young-adults", "personal finance for young adults", {
  accounts: 4,
  base: 6_000,
});
writeNiche("aiautomation", "aiautomation", {
  base: 1_200,
  fetchedAt: new Date(Date.now() - 48 * 3_600_000).toISOString(),
});

// lib/trending is imported after CREATORS_DATA_DIR is set.
let modulePromise: Promise<typeof import("../lib/trending")> | null = null;
function lib(): Promise<typeof import("../lib/trending")> {
  modulePromise ??= import("../lib/trending");
  return modulePromise;
}

// PGlite's query type is close to but not exactly Queryable; adapt it.
function asQueryable(pg: PGlite): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const res = await pg.query<T>(sql, params as never[]);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      return { rows: one.rows as T[] };
    },
  };
}

async function withFreshDb<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
  const pg = new PGlite();
  const q = asQueryable(pg);
  setDbForTests(q);
  try {
    await migrate(q);
    return await fn(q);
  } finally {
    await pg.close();
    resetDbForTests();
  }
}

// The disk ranker the cache tests inject: it never touches the fixture files.
const FAKE_RANKED: import("../lib/trending").TrendingNiche[] = [
  { slug: "fake", label: "Fake", query: "fake", score: 50, rank: 1 },
];

// Each test starts with an empty in-process ranking cache.
test.beforeEach(async () => {
  const { resetTrendingCache } = await lib();
  resetTrendingCache();
});

// --- rankTrending ---------------------------------------------------------

test("rankTrending caps at 30, sorts by score, ranks 1..n and dedupes slugs", async () => {
  const { rankTrending } = await lib();
  const money = ["personal finance", "home workout", "music covers"];
  const many: CachedNiche[] = Array.from({ length: 35 }, (_, i) =>
    cachedFixture(`niche-${i}`, money[i % money.length]!, { base: 1_000 + i * 137 }),
  );
  // A duplicate slug must not appear twice in the output.
  many.push(cachedFixture("niche-0", "personal finance", { base: 9_000 }));

  const out = rankTrending(many);

  assert.equal(out.length, 30);
  assert.deepEqual(
    out.map((n) => n.rank),
    Array.from({ length: 30 }, (_, i) => i + 1),
  );
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(
      out[i - 1]!.score >= out[i]!.score,
      `scores must descend: ${out[i - 1]!.score} < ${out[i]!.score}`,
    );
  }
  assert.equal(new Set(out.map((n) => n.slug)).size, out.length);
  assert.ok(out.every((n) => n.label && n.query && Number.isFinite(n.score)));
});

test("rankTrending returns [] for an empty cache", async () => {
  const { rankTrending } = await lib();
  assert.deepEqual(rankTrending([]), []);
});

test("rankTrending labels a glued tag through lib/nicheLabel", async () => {
  const { rankTrending } = await lib();
  const out = rankTrending([cachedFixture("ai", "aiautomation", { base: 1_200 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.label, "ai automation");
});

test("rankTrending skips rooms too thin to score", async () => {
  const { rankTrending } = await lib();
  // Fewer than three accounts cannot support the strict breakout baseline.
  const oneAccount = cachedFixture("solo", "home workout", { accounts: 1, per: 20 });
  const twoAccounts = cachedFixture("pair", "home workout", { accounts: 2, per: 8 });
  // A handful of reels is not a room.
  const fewReels = cachedFixture("few", "home workout", { accounts: 4, per: 2 });

  assert.deepEqual(rankTrending([oneAccount, twoAccounts, fewReels]), []);
});

test("rankTrending skips a poisoned room instead of aborting the ranking", async () => {
  const { rankTrending } = await lib();
  const good = cachedFixture("good", "home workout", { base: 2_500 });
  const poisoned = {
    ...cachedFixture("poisoned", "personal finance", { base: 6_000 }),
    // A corrupt cache row: long enough to reach the scorer, then unreadable.
    payload: [null, ...room("personal finance", { base: 6_000 })] as unknown as RawReel[],
  };

  const warn = console.warn;
  console.warn = () => {};
  try {
    const out = rankTrending([good, poisoned]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.slug, "good");
  } finally {
    console.warn = warn;
  }
});

test("stale niches are still eligible for bubbles", async () => {
  const { rankTrending } = await lib();
  const out = rankTrending([
    cachedFixture("old", "home workout", { base: 2_500, stale: true }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.slug, "old");
});

// --- listTrending ---------------------------------------------------------

test("listTrending with an empty table and 3 fixture niches on disk returns 3", async () => {
  const { listTrending } = await lib();
  await withFreshDb(async () => {
    const out = await listTrending();
    assert.equal(out.length, 3);
    assert.deepEqual(
      new Set(out.map((n) => n.query)),
      new Set(["home workout", "personal finance for young adults", "aiautomation"]),
    );
    assert.deepEqual(
      out.map((n) => n.rank),
      [1, 2, 3],
    );
  });
});

test("listTrending falls back to disk when the database is unavailable", async () => {
  const { listTrending } = await lib();
  resetDbForTests();
  delete process.env.DATABASE_URL;

  const out = await listTrending();
  assert.equal(out.length, 3);
});

test("listTrending caches the disk ranking for ten minutes", async () => {
  const { listTrending, DISK_RANK_TTL_MS } = await lib();
  await withFreshDb(async () => {
    let reads = 0;
    let now = 1_000_000;
    const rank = async () => {
      reads += 1;
      return FAKE_RANKED;
    };

    const first = await listTrending({ rankFromDisk: rank, now: () => now });
    now += DISK_RANK_TTL_MS - 1;
    const second = await listTrending({ rankFromDisk: rank, now: () => now });

    assert.equal(reads, 1);
    assert.deepEqual(first, second);
  });
});

test("listTrending re-reads the disk once the TTL has passed", async () => {
  const { listTrending, DISK_RANK_TTL_MS } = await lib();
  await withFreshDb(async () => {
    let reads = 0;
    let now = 1_000_000;
    const rank = async () => {
      reads += 1;
      return FAKE_RANKED;
    };

    await listTrending({ rankFromDisk: rank, now: () => now });
    now += DISK_RANK_TTL_MS;
    await listTrending({ rankFromDisk: rank, now: () => now });

    assert.equal(reads, 2);
  });
});

test("concurrent listTrending calls share one disk read", async () => {
  const { listTrending } = await lib();
  await withFreshDb(async () => {
    let reads = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rank = async () => {
      reads += 1;
      await held;
      return FAKE_RANKED;
    };

    const calls = Array.from({ length: 10 }, () =>
      listTrending({ rankFromDisk: rank, now: () => 1_000_000 }),
    );
    // Let all ten reach the fallback while the first read is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(reads, 1);

    release();
    const results = await Promise.all(calls);
    assert.equal(reads, 1);
    assert.ok(results.every((rows) => rows[0]?.slug === "fake"));
  });
});

test("a failed disk ranking is not cached", async () => {
  const { listTrending } = await lib();
  await withFreshDb(async () => {
    let reads = 0;
    const now = () => 1_000_000;

    await assert.rejects(() =>
      listTrending({
        rankFromDisk: async () => {
          reads += 1;
          throw new Error("disk ranking failed");
        },
        now,
      }),
    );

    const out = await listTrending({
      rankFromDisk: async () => {
        reads += 1;
        return FAKE_RANKED;
      },
      now,
    });

    assert.equal(reads, 2);
    assert.equal(out[0]!.slug, "fake");
  });
});

test("refreshTrending bypasses the cache and clears it after writing", async () => {
  const { listTrending, refreshTrending } = await lib();
  await withFreshDb(async (q) => {
    let reads = 0;
    const now = () => 1_000_000;
    const fake = async () => {
      reads += 1;
      return FAKE_RANKED;
    };

    // Prime the cache with the injected ranker.
    await listTrending({ rankFromDisk: fake, now });
    assert.equal(reads, 1);

    // The refresh must read the real disk (three fixture rooms), not the cache.
    const { written } = await refreshTrending();
    assert.equal(written, 3);

    // Emptying the table must not hand back the cached fake ranking.
    await q.query("DELETE FROM trending_niches");
    const out = await listTrending({ rankFromDisk: fake, now });
    assert.equal(reads, 2);
    assert.equal(out[0]!.slug, "fake");
  });
});

test("refreshTrending replaces rows from disk with no vendor spend", async () => {
  const { listTrending, refreshTrending } = await lib();
  await withFreshDb(async (q) => {
    await q.query(
      "INSERT INTO trending_niches (slug, label, query, score, rank, refreshed_at)" +
        " VALUES ($1, $2, $3, $4, $5, now())",
      ["bogus", "Bogus", "bogus", 99, 1],
    );

    resetCreditLedger();
    const { written } = await refreshTrending();
    assert.equal(written, 3);
    assert.equal(creditLedger().calls, 0);

    const { rows } = await q.query<{ slug: string; rank: number }>(
      "SELECT slug, rank FROM trending_niches ORDER BY rank ASC",
    );
    assert.equal(rows.length, 3);
    assert.ok(!rows.some((r) => r.slug === "bogus"), "old rows must be replaced");
    assert.deepEqual(
      rows.map((r) => r.rank),
      [1, 2, 3],
    );

    const listed = await listTrending();
    assert.equal(listed.length, 3);
  });
});

// --- cron helpers ---------------------------------------------------------

test("cronSecretOk compares hashed secrets and rejects a wrong one", async () => {
  const { cronSecretOk } = await lib();
  assert.equal(cronSecretOk("s3cret", "s3cret"), true);
  assert.equal(cronSecretOk("s3cret", "s3creT"), false);
  // Different lengths must not throw (the hashes are always the same length).
  assert.equal(cronSecretOk("", "s3cret"), false);
  assert.equal(cronSecretOk("a much longer guess", "short"), false);
});

test("researchStalest re-researches the 5 stalest niches only", async () => {
  const { researchStalest } = await lib();
  const stale = Array.from({ length: 7 }, (_, i) => ({
    slug: `stale-${i}`,
    query: `stale query ${i}`,
    fetchedAt: new Date().toISOString(),
    ageHours: 13 + i * 6,
    reels: 20,
    accounts: 4,
    stale: true,
  }));
  const freshButOld = {
    slug: "fresh",
    query: "fresh query",
    fetchedAt: new Date().toISOString(),
    ageHours: 999,
    reels: 20,
    accounts: 4,
    stale: false,
  };

  const calls: string[] = [];
  const result = await researchStalest(5, {
    list: async () => [...stale, freshButOld],
    research: async (opts) => {
      calls.push(opts.query);
      return {};
    },
  });

  assert.equal(calls.length, 5);
  assert.ok(!calls.includes("fresh query"), "fresh niches must not be re-bought");
  assert.equal(result.refreshed.length, 5);
  assert.equal(result.stopped, null);
});

test("researchStalest stops at the first budget error", async () => {
  const { researchStalest } = await lib();
  const stale = Array.from({ length: 5 }, (_, i) => ({
    slug: `stale-${i}`,
    query: `stale query ${i}`,
    fetchedAt: new Date().toISOString(),
    ageHours: 13 + i,
    reels: 20,
    accounts: 4,
    stale: true,
  }));

  const calls: string[] = [];
  const result = await researchStalest(5, {
    list: async () => stale,
    research: async (opts) => {
      calls.push(opts.query);
      if (calls.length === 2) {
        throw new Error("Not enough credits: no vendor can serve this search right now.");
      }
      return {};
    },
  });

  assert.equal(calls.length, 2, "must stop instead of trying the remaining niches");
  assert.equal(result.refreshed.length, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.stopped ?? "", /Not enough credits/);
});

test.after(() => {
  process.env.CREATORS_DATA_DIR = ENV_DATA;
  if (ENV_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ENV_DB;
  process.chdir(CWD);
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  resetDbForTests();
});
