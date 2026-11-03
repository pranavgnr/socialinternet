// The profile view and its store, plus the /api/profile read logic.
//   npm run test:file -- test-profile-view
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { buildProfileView } from "../lib/profileView";
import {
  readProfileView,
  saveProfileView,
  profileDir,
} from "../lib/profileStore";
import { runProfileRead } from "../lib/profileRequest";
import { enrichProfilePlan } from "../lib/profileData";
import { INTERNAL_WORDS } from "../lib/plain";
import { toCompetitorView, neutralisePerson } from "../lib/competitor";
import { migrate } from "../lib/migrate";
import { setDbForTests, resetDbForTests, type Queryable } from "../lib/db";
import { gate, settleAfter } from "../lib/gate";
import { balance } from "../lib/credits";
import { COSTS } from "../lib/costs";
import type { SessionUser } from "../lib/auth";
import type { GrowthPlan, RawReel, PlanCompetitor } from "../lib/types";

/* ------------------------------------------------------------------ fixtures */

let seq = 0;
function reel(views: number, likes?: number, comments?: number): RawReel {
  seq += 1;
  return {
    id: `r${seq}`,
    platform: "instagram",
    account: "fixture",
    url: `https://www.instagram.com/reel/r${seq}/`,
    caption: `caption ${seq}`,
    postedAt: new Date(Date.now() - seq * 86400000).toISOString(),
    views,
    likes: likes as number,
    comments: comments as number,
  };
}

/** N reels with strictly descending views, so the top/bottom split is unique. */
function reels(n: number): RawReel[] {
  return Array.from({ length: n }, (_, i) => reel(n - i, 10 + i, 1 + i));
}

function plan(overrides: Partial<GrowthPlan> = {}): GrowthPlan {
  return {
    handle: "fixture",
    niche: "telugu music covers",
    platform: "instagram",
    generatedAt: "2026-11-02T10:00:00.000Z",
    archetype: {
      id: "singer",
      label: "singer",
      blurb: "You post covers of songs people already love.",
      songLed: true,
      recommendation: "songs",
    },
    cohort: {
      accounts: 6,
      basis: "accounts about your size (8.2k followers)",
      nicheMedianViews: 12000,
      sizeMatched: true,
    },
    account: {
      followers: 8200,
      bio: "Covers, every week",
      category: "Musician",
    },
    standing: {
      followers: 8200,
      medianViews: 8000,
      bestViews: 40000,
      reelsRead: 12,
      vsNiche: 0.7,
      percentile: 0.4,
      accountRead: true,
      postsRead: true,
    },
    diagnosis: "You post covers people already know.",
    gaps: [],
    moves: [],
    questions: [],
    ...overrides,
  } as GrowthPlan;
}

const competitor = (h: string, views: number): PlanCompetitor => ({
  handle: h,
  views,
  url: `https://www.instagram.com/reel/${h}/`,
  caption: "a cover of a song",
  reasons: [`2.4x the typical post here · ${views} views`],
});

/* --------------------------------------------------------------- pure core */

test("winners/flops are disjoint and sized correctly across reel counts", () => {
  const cases: { n: number; winners: number; flops: number }[] = [
    { n: 12, winners: 3, flops: 3 },
    { n: 7, winners: 3, flops: 3 },
    { n: 6, winners: 3, flops: 3 },
    { n: 5, winners: 3, flops: 2 },
    { n: 4, winners: 2, flops: 2 },
    { n: 3, winners: 2, flops: 1 },
    { n: 2, winners: 1, flops: 1 },
    { n: 1, winners: 0, flops: 0 },
  ];

  for (const c of cases) {
    const view = buildProfileView(plan({ reels: reels(c.n) }), { own: false });
    assert.equal(view.winners.length, c.winners, `n=${c.n} winners`);
    assert.equal(view.flops.length, c.flops, `n=${c.n} flops`);

    const winnerUrls = new Set(view.winners.map((w) => w.url));
    for (const f of view.flops) {
      assert.ok(
        !winnerUrls.has(f.url),
        `n=${c.n}: a reel appears on both sides`,
      );
    }
    // Winners are strictly stronger than flops.
    const minWin = Math.min(...view.winners.map((w) => w.views));
    const maxFlop = Math.max(...view.flops.map((f) => f.views));
    if (view.winners.length && view.flops.length) {
      assert.ok(minWin > maxFlop, `n=${c.n}: winners must beat flops`);
    }
  }
});

test("a plan with no reels shows empty, explanatory lists rather than a guess", () => {
  const view = buildProfileView(plan({}), { own: false });
  assert.deepEqual(view.winners, []);
  assert.deepEqual(view.flops, []);
  assert.equal(view.vitals.reelsRead, 0);
  assert.equal(view.vitals.likesRatio, null);
});

test("older plans reconstruct from the audit's best and worst posts", () => {
  const view = buildProfileView(
    plan({
      audit: {
        posts: 12,
        watched: 0,
        medianViews: 8000,
        best: {
          views: 40000,
          multiple: 5,
          caption: "the one that travelled",
          url: "https://www.instagram.com/reel/best/",
        },
        worst: {
          views: 2000,
          multiple: 0.25,
          caption: "the one that did not",
          url: "https://www.instagram.com/reel/worst/",
        },
        cadence: {
          medianGapDays: 2,
          longestGapDays: 9,
          daysSinceLast: 1,
        },
        shapes: [],
        hookModes: [],
        breadth: 0,
        consistency: 0,
        ceiling: 5,
        versusPeers: "",
        gaps: [],
      },
    }),
    { own: false },
  );

  assert.equal(view.winners.length, 1);
  assert.equal(view.flops.length, 1);
  assert.equal(view.winners[0]?.url, "https://www.instagram.com/reel/best/");
  assert.equal(view.flops[0]?.url, "https://www.instagram.com/reel/worst/");
  // The audit carried no per-reel engagement, so it says so.
  assert.equal(view.winners[0]?.likes, null);
  assert.equal(view.winners[0]?.comments, null);
});

test("ratios and averages are computed only from the reels read", () => {
  const reelsRead = [
    reel(100, 10, 2),
    reel(200, 20, 4),
    // one reel with no likes and no comments must not poison the ratios
    reel(50, 0, 0),
  ];
  const view = buildProfileView(plan({ reels: reelsRead }), { own: false });

  // likes: 10+20=30 over views 100+200=300 → 0.1; avg likes 15.
  assert.equal(view.vitals.likesRatio, 0.1);
  assert.equal(view.vitals.avgLikes, 15);
  // comments: 2+4=6 over views 300 → 0.02; avg comments 3.
  assert.equal(view.vitals.commentRatio, 0.02);
  assert.equal(view.vitals.avgComments, 3);
  assert.equal(view.vitals.reelsRead, 3);
  // The unmeasured reel keeps its null engagement on the card.
  assert.equal(view.flops.at(-1)?.likes, null);
});

test("missing likes/comments read as null, never as zero", () => {
  const view = buildProfileView(plan({ reels: [reel(100), reel(50)] }), {
    own: false,
  });
  assert.equal(view.winners[0]?.likes, null);
  assert.equal(view.winners[0]?.comments, null);
  assert.equal(view.flops[0]?.likes, null);
  assert.equal(view.vitals.likesRatio, null);
  assert.equal(view.vitals.commentRatio, null);
});

test("botToReal is null in this task and no ratio is invented", () => {
  const view = buildProfileView(plan({}), { own: false });
  assert.equal(view.vitals.botToReal, null);
});

test("empty comments produce null commentIntel", () => {
  const view = buildProfileView(plan({ comments: undefined }), { own: false });
  assert.equal(view.commentIntel, null);

  const readNothing = buildProfileView(
    plan({
      comments: {
        read: 0,
        posts: 0,
        seeds: [],
        questions: [],
        objections: [],
        requests: [],
        language: [],
      },
    }),
    { own: false },
  );
  assert.equal(readNothing.commentIntel, null);
});

test("comments become a mood split and the top 3 requests with mentions", () => {
  const view = buildProfileView(
    plan({
      comments: {
        read: 10,
        posts: 3,
        seeds: [
          {
            text: "do the shopkeeper voice",
            kind: "request",
            asked: 5,
            likes: 9,
            ideas: [],
          },
          {
            text: "post part two",
            kind: "request",
            asked: 3,
            likes: 4,
            ideas: [],
          },
          {
            text: "sing in telugu",
            kind: "request",
            asked: 2,
            likes: 1,
            ideas: [],
          },
          {
            text: "make a tutorial",
            kind: "request",
            asked: 1,
            likes: 0,
            ideas: [],
          },
          {
            text: "how did you learn this",
            kind: "question",
            asked: 2,
            likes: 3,
            ideas: [],
          },
        ],
        questions: [],
        objections: [],
        requests: [],
        language: ["telugu"],
      },
    }),
    { own: false },
  );

  assert.ok(view.commentIntel, "comments should be present");
  if (!view.commentIntel) throw new Error("unreachable");

  // Requests capped at 3, ordered by mentions, from the request kind only.
  assert.equal(view.commentIntel.requests.length, 3);
  assert.equal(view.commentIntel.requests[0]?.mentions, 5);
  assert.equal(view.commentIntel.requests[0]?.text, "do the shopkeeper voice");
  // The mood split sums to 1 and every label is plain.
  const total = view.commentIntel.mood.reduce((s, m) => s + m.pct, 0);
  assert.ok(Math.abs(total - 1) < 1e-6, `mood sums to ${total}`);
});

test("ideas are capped at 3 with reasons and a script href", () => {
  const view = buildProfileView(
    plan({
      competitors: [
        competitor("alpha", 2400000),
        competitor("beta", 1200000),
        competitor("gamma", 800000),
        competitor("delta", 400000),
        competitor("epsilon", 200000),
      ],
    }),
    { own: false },
  );

  assert.equal(view.ideas.length, 3);
  assert.equal(view.ideas[0]?.fromHandle, "alpha");
  assert.equal(view.ideas[0]?.theirViews, "2.4M views");
  assert.ok(view.ideas[0]?.whyChosen.length, "reasons present");
  assert.equal(
    view.ideas[1]?.scriptHref,
    `/chat?action=script&idea=1&handle=${encodeURIComponent("fixture")}`,
  );
});

test("older plans read competitor ideas back from the move evidence", () => {
  const view = buildProfileView(
    plan({
      moves: [
        {
          id: "cohort-leader",
          priority: 1,
          title: "Make your version of @alpha's post",
          why: "It travelled.",
          action: "Make it.",
          evidence: [
            {
              handle: "@alpha",
              metric: "2.4x its usual views · 2.4M views",
              url: "https://www.instagram.com/reel/alpha/",
              caption: "a cover of a song",
            },
            {
              handle: "@fixture",
              metric: "6.7x your usual views · 635k views",
              url: "https://www.instagram.com/reel/mine/",
              caption: "my own cover",
            },
            {
              handle: "@weak",
              metric: "0.0x the typical post here · 173 views",
              url: "https://www.instagram.com/reel/weak/",
              caption: "a reel that did not travel",
            },
          ],
        },
      ],
    }),
    { own: false },
  );

  assert.equal(view.ideas.length, 1);
  assert.equal(view.ideas[0]?.fromHandle, "alpha");
  assert.equal(view.ideas[0]?.theirViews, "2.4M views");
  assert.equal(view.ideas[0]?.concept, "a cover of a song");
});

test("the own view carries the next move; the competitor view does not", () => {
  const p = plan({
    nextMove: {
      title: "Post the reaction",
      why: "Your best post was 5x your usual.",
      action: "Start on the reaction.",
      evidence: [],
      confidence: 0.8,
      basis: "your own posts",
      checkOn: "next week",
    },
  });
  assert.ok(buildProfileView(p, { own: true }).nextMove);
  assert.equal(
    buildProfileView(toCompetitorView(p), { own: false }).nextMove,
    undefined,
  );
});

test("nicheVerified is true only when the niche was derived from the posts", () => {
  assert.equal(
    buildProfileView(plan({ nicheSource: "model" }), { own: false })
      .nicheVerified,
    true,
  );
  assert.equal(
    buildProfileView(plan({ nicheSource: "captions" }), { own: false })
      .nicheVerified,
    true,
  );
  assert.equal(
    buildProfileView(plan({ nicheSource: "user" }), { own: false })
      .nicheVerified,
    false,
  );
  assert.equal(
    buildProfileView(plan({ nicheSource: undefined }), { own: false })
      .nicheVerified,
    false,
  );
});

test("no string in the view contains an internal word", () => {
  const view = buildProfileView(
    plan({
      reels: reels(8),
      competitors: [competitor("alpha", 2400000)],
      comments: {
        read: 4,
        posts: 2,
        seeds: [
          {
            text: "do the shopkeeper voice",
            kind: "request",
            asked: 3,
            likes: 2,
            ideas: [],
          },
        ],
        questions: [],
        objections: [],
        requests: [],
        language: ["telugu"],
      },
    }),
    { own: true },
  );

  const collect = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const item of value) collect(item, out);
    else if (value && typeof value === "object")
      for (const v of Object.values(value)) collect(v, out);
    return out;
  };

  for (const text of collect(view)) {
    for (const word of INTERNAL_WORDS) {
      assert.ok(
        !new RegExp(`\\b${word}\\b`, "i").test(text),
        `internal word "${word}" leaked: ${text}`,
      );
    }
  }
});

test("a competitor view has no second person in authored prose", () => {
  const p = plan({
    archetype: {
      id: "singer",
      label: "your singer",
      blurb: "You post covers of songs people already love.",
      songLed: true,
      recommendation: "songs",
    },
    standing: {
      followers: 8200,
      medianViews: 8000,
      bestViews: 40000,
      reelsRead: 12,
      vsNiche: 0.7,
      percentile: 0.4,
      accountRead: true,
      postsRead: true,
      unreadReason: "we could not read your recent posts",
    },
    nicheFit: {
      searched: "your comedy",
      score: 0.8,
      agreement: 0.8,
      verdict: "matches",
      ok: true,
      accounts: [],
      off: [],
      creatorShape: "your comedy",
      reasons: ["your posts matched this room"],
    },
    reels: reels(8),
    competitors: [competitor("alpha", 2400000)],
  });

  const view = buildProfileView(toCompetitorView(p), { own: false });
  const SECOND_PERSON = /\b(you|your|yours|you're|you've|you'll|yourself)\b/i;

  // Authored prose in the view — the summary and the why bullets — must be
  // third person. Audience requests and competitor captions are verbatim and
  // are checked separately by the caller.
  const authored = [
    view.dna.summary,
    ...view.winners.flatMap((w) => w.why),
    ...view.flops.flatMap((f) => f.why),
    ...view.ideas.flatMap((i) => i.whyChosen),
  ];
  for (const text of authored) {
    assert.doesNotMatch(text, SECOND_PERSON, `authored prose: ${text}`);
  }

  assert.match(view.dna.summary, /Covers, every week/);
});

test("neutralisePerson is the rule the competitor view relies on", () => {
  assert.equal(
    neutralisePerson("You post your own days."),
    "They post their own days.",
  );
});

/* ------------------------------------------------------------------- store */

const TMP = mkdtempSync(path.join(os.tmpdir(), "reel-engine-profile-"));
const ORIGINAL_DIR = process.env.CREATORS_DATA_DIR;
const ORIGINAL_TTL = process.env.PROFILE_CACHE_HOURS;

function setDataDir(dir: string): void {
  process.env.CREATORS_DATA_DIR = dir;
}
function restoreDir(): void {
  if (ORIGINAL_DIR === undefined) delete process.env.CREATORS_DATA_DIR;
  else process.env.CREATORS_DATA_DIR = ORIGINAL_DIR;
  if (ORIGINAL_TTL === undefined) delete process.env.PROFILE_CACHE_HOURS;
  else process.env.PROFILE_CACHE_HOURS = ORIGINAL_TTL;
}

test("profileStore round-trips a view and reads it back fresh", async () => {
  setDataDir(TMP);
  process.env.PROFILE_CACHE_HOURS = "168";
  try {
    const view = buildProfileView(plan({ reels: reels(8) }), { own: false });
    await saveProfileView("fixture", view);
    const read = await readProfileView("fixture", Date.now());
    assert.ok(read, "a just-written view must read back");
    assert.equal(read?.view.handle, "fixture");
    assert.equal(read?.view.winners.length, 3);
    assert.ok(read.ageHours < 1);
  } finally {
    restoreDir();
  }
});

test("an expired view reads as absent", async () => {
  setDataDir(TMP);
  process.env.PROFILE_CACHE_HOURS = "168";
  try {
    const view = buildProfileView(plan({ reels: reels(8) }), { own: false });
    await saveProfileView("fixture", view);
    const now = Date.now();
    // The default is 168 hours; 169 hours later it is stale.
    const later = now + 169 * 60 * 60 * 1000;
    assert.equal(await readProfileView("fixture", later), null);
  } finally {
    restoreDir();
  }
});

test("a hostile handle cannot traverse the profiles directory", async () => {
  setDataDir(TMP);
  try {
    await assert.rejects(
      () =>
        saveProfileView(
          "../../etc/passwd",
          buildProfileView(plan({}), { own: false }),
        ),
      /handle is required/,
    );
    assert.equal(await readProfileView("../outside", Date.now()), null);
    assert.equal(await readProfileView("a/b", Date.now()), null);
  } finally {
    restoreDir();
  }
});

test("an odd but legal handle stays inside the profiles directory", async () => {
  setDataDir(TMP);
  process.env.PROFILE_CACHE_HOURS = "168";
  try {
    const view = buildProfileView(plan({ handle: "__proto__", reels: reels(2) }), {
      own: false,
    });
    await saveProfileView("__proto__", view);
    const read = await readProfileView("__proto__", Date.now());
    assert.equal(read?.view.handle, "__proto__");
    assert.ok(profileDir().endsWith(path.join("profiles")));
  } finally {
    restoreDir();
  }
});

test("a corrupt stored view reads as absent, never crashes", async () => {
  setDataDir(TMP);
  try {
    const dir = profileDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "corrupt.json"), "{ not json");
    writeFileSync(
      path.join(dir, "shapeless.json"),
      JSON.stringify({ handle: "shapeless", savedAt: new Date().toISOString(), view: {} }),
    );
    assert.equal(await readProfileView("corrupt", Date.now()), null);
    assert.equal(await readProfileView("shapeless", Date.now()), null);
  } finally {
    restoreDir();
  }
});

test("disk-only enrichment fills reels and comments without a vendor call", () => {
  setDataDir(TMP);
  try {
    const handles = path.join(TMP, "handles");
    mkdirSync(handles, { recursive: true });
    writeFileSync(
      path.join(handles, "fixture.json"),
      JSON.stringify({
        handle: "fixture",
        reels: [
          {
            id: "r1",
            platform: "instagram",
            account: "fixture",
            url: "https://www.instagram.com/reel/one/",
            caption: "first",
            postedAt: "2026-11-01T00:00:00.000Z",
            views: 1000,
            likes: 100,
            comments: 10,
          },
          {
            id: "r2",
            platform: "instagram",
            account: "fixture",
            url: "https://www.instagram.com/reel/two/",
            caption: "second",
            postedAt: "2026-10-31T00:00:00.000Z",
            views: 100,
            likes: 5,
            comments: 1,
          },
        ],
      }),
    );
    writeFileSync(
      path.join(TMP, "_post_cache.json"),
      JSON.stringify({
        "https://www.instagram.com/reel/one/": {
          topComments: [
            { text: "Can you do a tutorial please?", likes: 2 },
            { text: "Can you do a tutorial please?", likes: 1 },
            { text: "This is beautiful", likes: 0 },
          ],
        },
      }),
    );

    const enriched = enrichProfilePlan(
      plan({
        moves: [
          {
            id: "m",
            priority: 1,
            title: "Make @alpha's post",
            why: "It travelled.",
            action: "Make it.",
            evidence: [
              {
                handle: "@alpha",
                metric: "2.4x its usual views · 2.4M views",
                url: "https://www.instagram.com/reel/alpha/",
                caption: "a cover",
              },
            ],
          },
        ],
      }),
    );

    assert.equal(enriched.reels?.length, 2);
    assert.equal(enriched.comments?.read, 1);
    assert.equal(enriched.competitors?.length, 1);

    const view = buildProfileView(enriched, { own: false });
    assert.equal(view.vitals.reelsRead, 2);
    assert.equal(view.winners.length, 1);
    assert.equal(view.flops.length, 1);
    assert.equal(view.commentIntel?.requests[0]?.mentions, 2);
    assert.equal(view.ideas[0]?.fromHandle, "alpha");
  } finally {
    restoreDir();
  }
});

/* --------------------------------------------------- /api/profile read logic */

const T0 = new Date("2026-11-02T10:00:00Z");

function asQueryable(pg: PGlite): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const res = await pg.query<T>(sql, params as never[]);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      return { rows: one.rows as T[] };
    },
  };
}

async function withFreshDb<T>(
  fn: (q: Queryable, userId: string) => Promise<T>,
): Promise<T> {
  const pg = new PGlite();
  const q = asQueryable(pg);
  setDbForTests(q);
  try {
    await migrate(q);
    const userId = randomUUID();
    await q.query(
      "INSERT INTO users (id, email, created_at) VALUES ($1, $2, now())",
      [userId, "creator@example.com"],
    );
    return await fn(q, userId);
  } finally {
    await pg.close();
  }
}

function sessionUser(id: string): SessionUser {
  return { id, email: "creator@example.com", name: null, legacyAccountId: null };
}

const competitorPlan = (): GrowthPlan =>
  plan({
    handle: "competitor_handle",
    reels: reels(8),
    competitors: [competitor("alpha", 2400000)],
    diagnosis: "You post covers people already know.",
    nextMove: {
      title: "Post the reaction",
      why: "Your best post was 5x your usual.",
      action: "Start on the reaction.",
      evidence: [],
      confidence: 0.8,
      basis: "your own posts",
      checkOn: "next week",
    },
  });

test("runProfileRead builds the neutral view and stores it", async () => {
  const stored: { handle: string; view: ReturnType<typeof buildProfileView> }[] = [];
  const result = await runProfileRead(
    { handle: "competitor_handle" },
    {
      runPlan: async () => ({
        plan: toCompetitorView(competitorPlan()),
        spent: 1,
      }),
      saveView: async (h, v) => {
        stored.push({ handle: h, view: v as ReturnType<typeof buildProfileView> });
      },
    },
  );
  assert.equal(result.handle, "competitor_handle");
  assert.equal(result.spent, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.handle, "competitor_handle");
  assert.equal(stored[0]?.view.own, false);
  assert.equal(stored[0]?.view.nextMove, undefined);
  assert.doesNotMatch(
    stored[0]?.view.dna.summary ?? "",
    /\b(you|your|yours)\b/i,
  );
});

test("a thrown run refunds the charge in full", async () => {
  await withFreshDb(async (_q, userId) => {
    const verdict = await gate("handle", {
      key: "competitor_handle",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    await assert.rejects(
      () =>
        settleAfter(
          verdict.entryId,
          async () => {
            await runProfileRead(
              { handle: "competitor_handle" },
              {
                runPlan: async () => {
                  throw new Error("vendor died");
                },
                saveView: async () => undefined,
              },
            );
          },
          () => 9,
        ),
      /vendor died/,
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("a failed save refunds the charge in full", async () => {
  await withFreshDb(async (_q, userId) => {
    const verdict = await gate("handle", {
      key: "competitor_handle",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    await assert.rejects(
      () =>
        settleAfter(
          verdict.entryId,
          async () => {
            await runProfileRead(
              { handle: "competitor_handle" },
              {
                runPlan: async () => ({ plan: competitorPlan(), spent: 6 }),
                saveView: async () => {
                  throw new Error("disk full");
                },
              },
            );
          },
          () => 9,
        ),
      /disk full/,
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
  });
});

test("a read the ledger measured as free refunds the charge", async () => {
  await withFreshDb(async (_q, userId) => {
    const verdict = await gate("handle", {
      key: "competitor_handle",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    let stored = false;
    await settleAfter(
      verdict.entryId,
      async () => {
        await runProfileRead(
          { handle: "competitor_handle" },
          {
            runPlan: async () => ({ plan: competitorPlan(), spent: 0 }),
            saveView: async () => {
              stored = true;
            },
          },
        );
      },
      () => 0,
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree);
    assert.equal(stored, true);
  });
});

test("a successful paid read charges once and stores the view", async () => {
  await withFreshDb(async (_q, userId) => {
    const verdict = await gate("handle", {
      key: "competitor_handle",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    if (!verdict.ok) throw new Error("gate should charge");

    let stored = false;
    await settleAfter(
      verdict.entryId,
      async () => {
        await runProfileRead(
          { handle: "competitor_handle" },
          {
            runPlan: async () => ({ plan: competitorPlan(), spent: 6 }),
            saveView: async () => {
              stored = true;
            },
          },
        );
      },
      () => 0.02, // measured vendor spend: non-zero → charge kept
    );
    assert.equal(await balance(userId, T0), COSTS.dailyFree - COSTS.handle);
    assert.equal(stored, true);
  });
});

test("an anonymous read is refused at 401 and a drained pool at 402", async () => {
  await withFreshDb(async (_q, userId) => {
    const anon = await gate("handle", {
      key: "competitor_handle",
      getUser: async () => null,
      now: T0,
    });
    assert.deepEqual(anon, {
      ok: false,
      status: 401,
      message: "Sign in to read a new one",
    });

    // Drain the pool, then a fresh read must refuse at 402.
    await balance(userId, T0);
    const first = await gate("handle", {
      key: "a",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    const second = await gate("handle", {
      key: "b",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    assert.ok(first.ok && second.ok, "the first two reads should charge");
    const third = await gate("handle", {
      key: "c",
      getUser: async () => sessionUser(userId),
      now: T0,
    });
    assert.equal(third.ok, false);
    if (!third.ok) assert.equal(third.status, 402);
  });
});

test.after(() => {
  resetDbForTests();
  restoreDir();
  rmSync(TMP, { recursive: true, force: true });
});
