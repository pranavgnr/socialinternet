// The niche dossier's pure core, the query helper, the access decision, and a
// read-only pass over every cached room on disk:
//   npm run test:file -- test-niche-dossier
//
// The disk pass is skipped when no shared data directory is configured (or the
// directory has no niches). Point CREATORS_DATA_DIR at the cache to include it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EMPTY_DOSSIER_LINE,
  OUTLIER_LIMIT,
  ageLabel,
  buildDossier,
  decodeNicheParam,
  nicheAccess,
  parseNicheQuery,
  safeReelUrl,
} from "../lib/nicheDossier";
import {
  cachedNiches,
  cachedNichePull,
  nicheView,
  researchFromCache,
} from "../lib/niche";
import { listTrending } from "../lib/trending";
import type { NicheReelRow, NicheView } from "../lib/niche";
import { INTERNAL_WORDS } from "../lib/plain";

/* ------------------------------------------------------------------ fixtures */

let seq = 0;

function row(overrides: Partial<NicheReelRow> = {}): NicheReelRow {
  seq += 1;
  return {
    account: `account_${seq}`,
    platform: "instagram",
    url: `https://www.instagram.com/reel/fixture_${seq}/`,
    caption: `caption ${seq}`,
    views: 1_000,
    ...overrides,
  };
}

function view(rows: NicheReelRow[], overrides: Partial<NicheView> = {}): NicheView {
  const accounts = new Set(rows.map((r) => r.account.toLowerCase())).size;
  return {
    query: "fixture niche",
    fetchedAt: "2026-11-03T06:00:00.000Z",
    cached: true,
    ageHours: 2,
    credits: { spent: 0, calls: 0, remaining: null },
    reels: rows.length,
    scanned: rows.length,
    accountCount: accounts,
    nicheMedianViews: 1_000,
    top: [],
    hashtags: [],
    errors: [],
    language: {
      name: null,
      basis: "none",
      kept: rows.length,
      dropped: 0,
      confirmed: null,
      leftOut: [],
    },
    subject: { applied: false, dropped: 0, judged: { scored: 0, of: 0 } },
    reelRows: rows,
    ...overrides,
  };
}

/* ------------------------------------------------------------ query decoding */

test("decodeNicheParam decodes a normal phrase and collapses whitespace", () => {
  assert.equal(decodeNicheParam("kannada%20songs"), "kannada songs");
  assert.equal(decodeNicheParam("  kannada   songs  "), "kannada songs");
  assert.equal(decodeNicheParam(encodeURIComponent("कन्नड़")), "कन्नड़");
});

test("decodeNicheParam survives malformed percent-encoding", () => {
  // A lone percent and a truncated escape both throw inside decodeURIComponent.
  assert.doesNotThrow(() => decodeNicheParam("%E0%A4%A"));
  assert.equal(decodeNicheParam("%E0%A4%A"), "%E0%A4%A");
  assert.equal(decodeNicheParam("100% off"), "100% off");
  assert.equal(decodeNicheParam(undefined), "");
});

test("parseNicheQuery enforces 2 to 120 characters and a real word", () => {
  assert.deepEqual(parseNicheQuery("kannada%20songs"), {
    ok: true,
    query: "kannada songs",
  });
  assert.deepEqual(parseNicheQuery("a"), { ok: false, reason: "short" });
  assert.deepEqual(parseNicheQuery(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseNicheQuery("%20%20"), { ok: false, reason: "empty" });
  assert.deepEqual(parseNicheQuery("!!!"), { ok: false, reason: "punctuation" });
  assert.deepEqual(parseNicheQuery("x".repeat(121)), { ok: false, reason: "long" });
  assert.equal(parseNicheQuery("x".repeat(120)).ok, true);
  // Unicode is counted as characters, not UTF-16 code units.
  assert.equal(parseNicheQuery("कन्नड़").ok, true);
});

test("ageLabel says how old a cached room is without inventing precision", () => {
  assert.equal(ageLabel(0.2), "just now");
  assert.equal(ageLabel(3), "3h ago");
  assert.equal(ageLabel(23.4), "23h ago");
  assert.equal(ageLabel(30), "yesterday");
  assert.equal(ageLabel(72), "3d ago");
  // A malformed fetchedAt is not allowed to print "NaN".
  assert.equal(ageLabel(Number.NaN), "just now");
});

/* ------------------------------------------------------------ access decision */

test("nicheAccess has the full truth table", () => {
  assert.equal(nicheAccess({ cached: true, signedIn: true }), "show");
  assert.equal(nicheAccess({ cached: true, signedIn: false }), "show");
  assert.equal(nicheAccess({ cached: false, signedIn: true }), "read-panel");
  assert.equal(nicheAccess({ cached: false, signedIn: false }), "sign-in");
});

/* --------------------------------------------------------------- reel links */

test("safeReelUrl accepts Instagram hosts and rejects everything else", () => {
  assert.equal(
    safeReelUrl("https://www.instagram.com/reel/Cxyz/"),
    "https://www.instagram.com/reel/Cxyz/",
  );
  assert.equal(
    safeReelUrl("http://instagram.com/reel/Cxyz/"),
    "https://instagram.com/reel/Cxyz/",
  );
  assert.equal(safeReelUrl("https://instagram.com.evil.example/reel/1/"), null);
  assert.equal(safeReelUrl("https://youtube.com/shorts/abc"), null);
  assert.equal(safeReelUrl("https://www.tiktok.com/@a/video/1"), null);
  assert.equal(safeReelUrl("javascript:alert(1)"), null);
  assert.equal(safeReelUrl(""), null);
});

/* -------------------------------------------------------------- ordering, cap */

test("outliers are ranked by views per follower, with unknown sizes last", () => {
  const dossier = buildDossier(
    view([
      row({ account: "low", views: 3_000, followers: 500 }), // 6x
      row({ account: "unknown_small", views: 2_000 }), // null
      row({ account: "best", views: 14_000, followers: 1_000 }), // 14x
      row({ account: "unknown_big", views: 5_000 }), // null
      row({ account: "tie_big", views: 16_000, followers: 2_000 }), // 8x
      row({ account: "tie_small", views: 8_000, followers: 1_000 }), // 8x
      row({ account: "middle", views: 9_000, followers: 1_000 }), // 9x
    ]),
  );

  assert.deepEqual(
    dossier.outliers.map((o) => o.handle),
    ["best", "middle", "tie_big", "tie_small", "low", "unknown_big", "unknown_small"],
  );
  assert.equal(dossier.outliers[0]?.multiple, 14);
  assert.equal(dossier.outliers.at(-1)?.multiple, null);
});

test("a tie in both multiple and views falls back to the URL", () => {
  const a = row({
    account: "a",
    views: 5_000,
    followers: 1_000,
    url: "https://www.instagram.com/reel/b/",
  });
  const b = row({
    account: "b",
    views: 5_000,
    followers: 1_000,
    url: "https://www.instagram.com/reel/a/",
  });

  assert.deepEqual(
    buildDossier(view([a, b])).outliers.map((o) => o.url),
    [
      "https://www.instagram.com/reel/a/",
      "https://www.instagram.com/reel/b/",
    ],
  );
});

test("at most twelve outliers are listed", () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    row({
      account: `account_${i}`,
      views: 20_000 - i * 100,
      followers: 1_000,
      url: `https://www.instagram.com/reel/cap_${i}/`,
    }),
  );

  assert.equal(buildDossier(view(rows)).outliers.length, OUTLIER_LIMIT);
});

test("one reel per account wins the first twelve places, then seconds fill", () => {
  // Twelve accounts, one of which owns the second-strongest reel in the room.
  // The first pass must take every account once before that second reel, so the
  // highest-viewed second reel cannot bump a smaller account out of the list.
  const rows = [
    row({ account: "stars", views: 10_000, followers: 1_000 }), // 10x
    row({
      account: "stars",
      views: 9_900,
      followers: 1_000,
      url: "https://www.instagram.com/reel/stars_second/",
    }), // 9.9x
  ];
  for (let i = 1; i < 12; i += 1) {
    rows.push(
      row({
        account: `account_${i}`,
        views: 100 - i,
        followers: 1_000,
        url: `https://www.instagram.com/reel/account_${i}/`,
      }),
    );
  }

  const dossier = buildDossier(view(rows));
  assert.equal(dossier.outliers.length, 12);
  assert.equal(
    dossier.outliers.filter((o) => o.handle === "stars").length,
    1,
    "the second reel from the strongest account is not listed while 12 accounts exist",
  );
  assert.equal(dossier.outliers.some((o) => o.url.endsWith("/stars_second/")), false);
  assert.equal(
    dossier.outliers.some((o) => o.handle === "account_11"),
    true,
    "the smallest account still gets its one place",
  );
});

test("second reels fill the list when there are fewer than twelve accounts", () => {
  const rows: NicheReelRow[] = [];
  for (let a = 0; a < 5; a += 1) {
    for (let i = 0; i < 4; i += 1) {
      rows.push(
        row({
          account: `account_${a}`,
          views: 5_000 - a * 500 - i * 100,
          followers: 1_000,
          url: `https://www.instagram.com/reel/a${a}_${i}/`,
        }),
      );
    }
  }

  const dossier = buildDossier(view(rows));
  assert.equal(dossier.outliers.length, 12);
  assert.equal(new Set(dossier.outliers.map((o) => o.handle)).size, 5);
});

test("non-Instagram rows are dropped defensively", () => {
  const dossier = buildDossier(
    view([
      row({ account: "ig", platform: "instagram", views: 2_000, followers: 1_000 }),
      row({
        account: "yt",
        platform: "youtube",
        url: "https://www.youtube.com/shorts/abc",
        views: 1_000_000,
      }),
      row({
        account: "tt",
        platform: "tiktok",
        url: "https://www.tiktok.com/@tt/video/1",
        views: 900_000,
      }),
    ]),
  );

  assert.deepEqual(dossier.outliers.map((o) => o.handle), ["ig"]);
});

/* --------------------------------------------------------------- briefing */

test("briefing is three to five sentences built from the page's numbers", () => {
  const rows = [
    row({ account: "small_one", views: 8_000, followers: 20_000 }), // 0.4x
    row({ account: "small_two", views: 4_000, followers: 50_000 }), // 0.08x
    row({ account: "big", views: 12_000, followers: 400_000 }), // 0.03x
    row({ account: "unknown", views: 3_000 }),
  ];
  const dossier = buildDossier(
    view(rows, {
      reels: 20,
      accountCount: 9,
      nicheMedianViews: 2_000,
      language: {
        name: "Kannada",
        basis: "query",
        kept: 20,
        dropped: 3,
        confirmed: 0.8,
        leftOut: [],
      },
    }),
  );

  assert.ok(dossier.briefing.length >= 3 && dossier.briefing.length <= 5);
  const text = dossier.briefing.join(" ");
  assert.match(text, /2k views/); // the bar to beat
  assert.match(text, /20 reels read/);
  assert.match(text, /4 reels below/);
  assert.match(text, /under 100k followers/);
  assert.match(text, /Kannada/);

  const lowered = text.toLowerCase();
  for (const banned of ["algorithm", "shift", "instagram is", "trending now"]) {
    assert.equal(lowered.includes(banned), false, `briefing must not say "${banned}"`);
  }
  for (const word of INTERNAL_WORDS) {
    assert.equal(
      lowered.includes(word.toLowerCase()),
      false,
      `briefing must not contain the internal word "${word}"`,
    );
  }
});

test("the small-account sentence counts only reels whose size was read", () => {
  const rows = [
    row({ account: "small_known", views: 5_000, followers: 20_000 }),
    row({ account: "big_known", views: 6_000, followers: 900_000 }),
    row({ account: "unknown", views: 7_000 }),
  ];
  const text = buildDossier(view(rows)).briefing.join(" ");

  assert.match(
    text,
    /1 of the 2 reels listed with a follower count comes from accounts under 100k followers\./,
  );
  // The unknown-size reel must not be counted as either small or large.
  assert.doesNotMatch(text, /of the 3 reels listed/);
});

test("a room with no usual-view bar still gets at least three sentences", () => {
  const dossier = buildDossier(
    view(
      [
        row({ account: "a", views: 1_000, followers: 1_000 }),
        row({ account: "b", views: 2_000, followers: 1_000 }),
      ],
      { reels: 2, accountCount: 2, nicheMedianViews: 0 },
    ),
  );

  assert.equal(dossier.bar, undefined);
  assert.ok(dossier.briefing.length >= 3 && dossier.briefing.length <= 5);
  assert.match(dossier.briefing.join(" "), /No usual view count was read/);
});

test("a room with no settled language does not claim one", () => {
  // nicheView() renders an undecided room as `name: "this language"` with
  // `basis: "none"`; that is a placeholder, not a language claim.
  const dossier = buildDossier(
    view([row({ account: "solo", views: 5_000, followers: 1_000 })], {
      language: {
        name: "this language",
        basis: "none",
        kept: 1,
        dropped: 0,
        confirmed: null,
        leftOut: [],
      },
    }),
  );

  assert.equal(
    dossier.briefing.some((line) => /in this language/i.test(line)),
    false,
  );
});

test("briefing agrees in number when only one reel is listed", () => {
  const dossier = buildDossier(
    view([row({ account: "solo", views: 5_000, followers: 1_000 })], {
      reels: 1,
      accountCount: 1,
      nicheMedianViews: 1_000,
    }),
  );
  const text = dossier.briefing.join(" ");

  assert.match(text, /The 1 reel below comes from 1 account\./);
  assert.match(text, /across 1 reel read\./);
});

test("an empty room is a calm empty state with no numbers", () => {
  const dossier = buildDossier(
    view([], { reels: 0, accountCount: 0, nicheMedianViews: 0 }),
  );

  assert.deepEqual(dossier.outliers, []);
  assert.deepEqual(dossier.briefing, []);
  assert.deepEqual(dossier.counts, { reels: 0, accounts: 0, breakouts: 0 });
  assert.equal(dossier.bar, undefined);
  assert.match(EMPTY_DOSSIER_LINE, /No reels read for this niche yet/);
});

test("counts measure the room, not just the twelve listed", () => {
  const rows = [
    row({ account: "a", views: 10_000, followers: 1_000 }),
    row({ account: "a", views: 9_000, followers: 1_000 }),
    row({ account: "b", views: 3_000, followers: 1_000 }),
    row({ account: "c", views: 500, followers: 1_000 }),
  ];
  const dossier = buildDossier(
    view(rows, { reels: 4, accountCount: 3, nicheMedianViews: 1_000 }),
  );

  assert.deepEqual(dossier.counts, { reels: 4, accounts: 3, breakouts: 2 });
  assert.equal(dossier.bar?.views, 1_000);
});

test("breakouts never exceed the accounts the briefing names", () => {
  /**
   * The account summary can be thinner than the reel rows: a sighting with one
   * viral reel may not reach the summary's account list. Both counts must come
   * from the same set, or the sentence reads "2 of the 1 accounts read".
   */
  const rows = [
    row({ account: "viral_one", views: 50_000, followers: 1_000 }),
    row({ account: "viral_two", views: 40_000, followers: 1_000 }),
    row({ account: "steady", views: 1_000, followers: 1_000 }),
  ];
  const dossier = buildDossier(
    view(rows, { reels: 3, accountCount: 1, nicheMedianViews: 1_000 }),
  );

  assert.equal(dossier.counts.accounts, 3);
  assert.ok(dossier.counts.breakouts <= dossier.counts.accounts);

  const sentence = dossier.briefing.find((line) =>
    /accounts read have/.test(line),
  );
  assert.ok(sentence, "the breakout sentence is still stated when it is true");
  const match = sentence.match(/^(\d+) of the (\d+) accounts read/);
  assert.ok(match, sentence);
  assert.ok(Number(match[1]) <= Number(match[2]), sentence);
});

test("the dossier falls back to the account rows when reel rows are absent", () => {
  const dossier = buildDossier(
    view([], {
      reels: 1,
      accountCount: 1,
      nicheMedianViews: 1_000,
      reelRows: undefined,
      top: [
        {
          handle: "topper",
          platform: "instagram",
          followers: 10_000,
          reels: 3,
          medianViews: 8_000,
          bestViews: 40_000,
          outliers: 1,
          measured: true,
          topReel: {
            url: "https://www.instagram.com/reel/topper/",
            caption: "the best one",
            views: 40_000,
          },
        },
      ],
    }),
  );

  assert.deepEqual(dossier.outliers.map((o) => o.handle), ["topper"]);
  assert.equal(dossier.outliers[0]?.multiple, 4);
});

/* ---------------------------------------------------------- the disk lookup */

test("cachedNichePull serves an expired room with its age, and never as a path", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reel-engine-niche-"));
  const niches = path.join(root, "niches");
  mkdirSync(niches);

  const fetchedAt = new Date(Date.now() - 30 * 3_600_000).toISOString();
  const postedAt = new Date(Date.now() - 40 * 3_600_000).toISOString();
  writeFileSync(
    path.join(niches, "stale-room.json"),
    JSON.stringify({
      v: 2,
      fetchedAt,
      query: "Stale Room",
      payload: [
        {
          id: "1",
          platform: "instagram",
          account: "someone",
          url: "https://www.instagram.com/reel/stale/",
          caption: "a reel",
          postedAt,
          views: 10,
          likes: 1,
          comments: 0,
        },
      ],
      errors: [],
    }),
  );

  const previousRoot = process.env.CREATORS_DATA_DIR;
  const previousTtl = process.env.NICHE_CACHE_HOURS;
  process.env.CREATORS_DATA_DIR = root;
  process.env.NICHE_CACHE_HOURS = "12";

  try {
    const pull = await cachedNichePull("Stale Room");
    assert.ok(pull);
    assert.equal(pull.query, "Stale Room");
    assert.equal(pull.payload.length, 1);
    assert.equal(pull.stale, true);
    assert.ok(pull.ageHours > 29 && pull.ageHours < 31);

    // The phrase is reduced to a slug before it can name a file.
    assert.equal(await cachedNichePull("../../etc/passwd"), null);
  } finally {
    process.env.CREATORS_DATA_DIR = previousRoot;
    process.env.NICHE_CACHE_HOURS = previousTtl;
    if (previousRoot === undefined) delete process.env.CREATORS_DATA_DIR;
    if (previousTtl === undefined) delete process.env.NICHE_CACHE_HOURS;
    rmSync(root, { recursive: true, force: true });
  }
});

/* ----------------------------------------------------- the shared data cache */

const dataRoot = process.env.CREATORS_DATA_DIR
  ? path.resolve(process.env.CREATORS_DATA_DIR)
  : path.join(process.cwd(), "data");
const nichesDir = path.join(dataRoot, "niches");
const hasNiches =
  existsSync(nichesDir) &&
  readdirSync(nichesDir).some((file) => file.endsWith(".json"));

test(
  "every cached niche builds a dossier without throwing or leaking another platform",
  { skip: hasNiches ? false : `no niches on disk at ${nichesDir}` },
  async () => {
    const cached = await cachedNiches({ withPayload: true });
    assert.ok(cached.length > 0, "expected at least one cached niche");

    for (const entry of cached) {
      const research = researchFromCache(entry.query, entry.payload ?? [], {
        fetchedAt: entry.fetchedAt,
      });
      const niche = nicheView(research, OUTLIER_LIMIT, { dossier: true });
      const dossier = buildDossier(niche);

      for (const outlier of dossier.outliers) {
        assert.ok(
          safeReelUrl(outlier.url),
          `${entry.slug}: ${outlier.url} is not a safe Instagram link`,
        );
        assert.equal(
          /youtu\.?be|youtube\.com|tiktok\.com|facebook\.com/i.test(outlier.url),
          false,
          `${entry.slug}: a non-Instagram row reached the dossier`,
        );
      }
      assert.ok(
        dossier.briefing.length === 0 ||
          (dossier.briefing.length >= 3 && dossier.briefing.length <= 5),
        `${entry.slug}: briefing length ${dossier.briefing.length}`,
      );
      assert.ok(
        dossier.counts.breakouts <= dossier.counts.accounts,
        `${entry.slug}: ${dossier.counts.breakouts} breakouts of ${dossier.counts.accounts} accounts`,
      );

      const breakoutLine = dossier.briefing.find((line) =>
        /accounts read have/.test(line),
      );
      if (breakoutLine) {
        const match = breakoutLine.match(/^(\d+) of the (\d+) accounts read/);
        assert.ok(match, `${entry.slug}: ${breakoutLine}`);
        assert.ok(
          Number(match[1]) <= Number(match[2]),
          `${entry.slug}: ${breakoutLine}`,
        );
      }
    }
  },
);

test(
  "every landing bubble opens a non-empty dossier from the shared cache",
  { skip: hasNiches ? false : `no niches on disk at ${nichesDir}` },
  async () => {
    /**
     * The bubbles are supposed to come from the disk ranking when the table is
     * empty or Postgres is down. Delete the URL so this test exercises that
     * documented path and never depends on a developer's database; restore it
     * in a finally so a later test (or an interactive run) keeps its setting.
     */
    const previousDb = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      const bubbles = await listTrending();
      assert.ok(bubbles.length > 0, "expected at least one landing bubble");

      const failures: string[] = [];
      for (const bubble of bubbles) {
        const pull = await cachedNichePull(bubble.query);
        if (!pull) {
          failures.push(`"${bubble.query}" (${bubble.slug}): not on disk`);
          continue;
        }

        const dossier = buildDossier(
          nicheView(
            researchFromCache(pull.query, pull.payload, {
              fetchedAt: pull.fetchedAt,
              errors: pull.errors,
            }),
            OUTLIER_LIMIT,
            { dossier: true },
          ),
        );
        if (!dossier.outliers.length) {
          failures.push(`"${bubble.query}" (${bubble.slug}): empty dossier`);
        }
      }

      assert.deepEqual(
        failures,
        [],
        `bubbles without a dossier: ${failures.join("; ")}`,
      );
    } finally {
      if (previousDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDb;
    }
  },
);
