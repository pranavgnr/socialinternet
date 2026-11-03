// The profile view and its store, plus the /api/profile read logic.
//   npm run test:file -- test-profile-view
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import { buildProfileView, assertInstagramOnly, reelsToRead, reelBasisLine, type ProfileView } from "../lib/profileView";
import {
  readAuthenticity,
  type FollowerSampleRow,
} from "../lib/authenticity";
import { creditLedger, resetCreditLedger } from "../lib/providers";
import { CaptionReader, configuredReader, type VideoReading } from "../lib/videoReader";
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

/**
 * These tests must never reach a vendor, even when the developer's shell has a
 * key exported. The one spend test below sets exactly the keys it needs.
 */
for (const key of [
  "HIKERAPI_KEY",
  "APIFY_TOKEN",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "GEMINI_API_KEY",
]) {
  delete process.env[key];
}

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
  platform: "instagram",
  views,
  url: `https://www.instagram.com/reel/${h}/`,
  caption: "a cover of a song",
  reasons: [`2.4x the typical post here · ${views} views`],
});

/** A sample of followers who all look like people, for the estimate tests. */
function cleanFollowers(n: number): FollowerSampleRow[] {
  return Array.from({ length: n }, (_, i) => ({
    username: `person_${i}`,
    full_name: `Person ${i}`,
    is_private: false,
    profile_pic_url: `https://scontent.cdninstagram.com/v/t51/photo-${i}.jpg`,
  }));
}

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

test("botToReal is null when no estimate was bought, and never invented", () => {
  const view = buildProfileView(plan({}), { own: false });
  assert.equal(view.vitals.botToReal, null);
});

test("a bought estimate lands in the vitals exactly as measured", () => {
  const view = buildProfileView(plan({}), {
    own: false,
    authenticity: { realPct: 71, sample: 60, confidence: "medium" },
  });
  assert.deepEqual(view.vitals.botToReal, {
    realPct: 71,
    sample: 60,
    confidence: "medium",
  });
});

test("a watched reel gets its own bullets and the hook line", () => {
  const p = plan({ reels: reels(8) });
  const preview = buildProfileView(p, { own: false });
  const watched = preview.winners[0]?.url ?? "";
  const readings = new Map<string, VideoReading>([
    [
      watched,
      {
        basis: "video",
        hookSeconds: 0.8,
        hookType: "spoken",
        onScreenText: "POV: you wake up",
        pacing: "fast cuts, one idea per second",
        loop: true,
        why: ["It opens on a question", "The text lands before the first word"],
      },
    ],
  ]);

  const view = buildProfileView(p, { own: false, readings });
  const card = view.winners[0];
  assert.equal(card?.basis, "video");
  assert.equal(card?.why[0], "Hook: spoken, lands at 0.8 s");
  assert.deepEqual(card?.why.slice(1), [
    "It opens on a question",
    "The text lands before the first word",
  ]);

  // Every other card keeps the arithmetic bullets and tells the truth about it.
  assert.equal(view.winners[1]?.basis, "captions");
  for (const flop of view.flops) assert.equal(flop.basis, "captions");
});

test("the video reader watches exactly the reels the cards show", () => {
  for (const n of [12, 7, 5, 2, 1]) {
    const p = plan({ reels: reels(n) });
    const view = buildProfileView(p, { own: false });
    const shown = [...view.winners, ...view.flops].map((card) => card.url);
    const watched = reelsToRead(p).map((reel) => reel.url);
    assert.deepEqual(watched, shown, `n=${n}`);
    assert.equal(new Set(watched).size, watched.length, `n=${n}: no duplicates`);
  }
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
  assert.equal(view.ideas[0]?.platform, "instagram");
  assert.equal(view.ideas[0]?.theirViews, "2.4M views");
  assert.ok(view.ideas[0]?.whyChosen.length, "reasons present");
  assert.equal(
    view.ideas[0]?.scriptHref,
    `/chat?action=script&idea=1&handle=${encodeURIComponent("fixture")}`,
  );
  assert.equal(
    view.ideas[1]?.scriptHref,
    `/chat?action=script&idea=2&handle=${encodeURIComponent("fixture")}`,
  );
});

test("a YouTube competitor is never turned into an idea", () => {
  const view = buildProfileView(
    plan({
      competitors: [
        {
          ...competitor("youtube_star", 2400000),
          platform: "youtube",
          url: "https://www.youtube.com/watch?v=abc",
        },
      ],
    }),
    { own: false },
  );
  assert.deepEqual(view.ideas, []);
  assert.equal(view.vitals.reelsRead, 0);
});

test("a competitor without a platform is treated as not Instagram", () => {
  const legacy = {
    ...competitor("legacy", 2400000),
  } as Partial<PlanCompetitor>;
  delete legacy.platform;

  const view = buildProfileView(
    plan({ competitors: [legacy as PlanCompetitor] }),
    { own: false },
  );
  assert.deepEqual(view.ideas, []);
});

test("legacy move evidence without platforms produces no ideas", () => {
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
          ],
        },
      ],
    }),
    { own: false },
  );

  assert.deepEqual(view.ideas, []);
});

test("all-dropped competitors yield the empty state, not a crash", () => {
  const view = buildProfileView(
    plan({
      competitors: [
        { ...competitor("yt", 100), platform: "youtube" },
        { ...competitor("missing", 100), platform: undefined as never },
      ],
    }),
    { own: false },
  );
  assert.deepEqual(view.ideas, []);
});

test("assertInstagramOnly accepts Instagram cards and ideas", () => {
  const view = buildProfileView(
    plan({ reels: reels(2), competitors: [competitor("alpha", 2400000)] }),
    { own: false },
  );
  assert.doesNotThrow(() => assertInstagramOnly(view));
});

test("assertInstagramOnly refuses a non-Instagram reel or idea", () => {
  const view = buildProfileView(
    plan({ reels: reels(2), competitors: [competitor("alpha", 2400000)] }),
    { own: false },
  );

  assert.throws(
    () =>
      assertInstagramOnly({
        ...view,
        winners: [{ ...view.winners[0], url: "https://www.youtube.com/watch?v=x" }],
      }),
    /not an Instagram URL/,
  );

  assert.throws(
    () =>
      assertInstagramOnly({
        ...view,
        ideas: [{ ...view.ideas[0], platform: "youtube" as never }],
      }),
    /not Instagram/,
  );
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

test("summary describes the creator; cohort caveats move to the footnote", () => {
  const p = plan({
    account: {
      followers: 8200,
      bio: "Covers, every week",
      category: "Musician",
    },
    diagnosis:
      "You usually get around 8k views a post. The group we compared you with was not your room, so read the numbers below as provisional.",
    cohort: {
      accounts: 4,
      basis:
        "everyone in this space (4 accounts) — not enough close to your size to call a cohort",
      nicheMedianViews: 12000,
      sizeMatched: false,
    },
    nicheFit: {
      searched: "telugu music covers",
      score: 0.4,
      agreement: 0.13,
      verdict: "wrong",
      ok: false,
      accounts: [],
      off: [],
      creatorShape: "singer",
      reasons: [
        "Nothing the search returned looks like this account — 24 of 32 were in a different space.",
      ],
    },
    comments: {
      read: 3,
      posts: 1,
      seeds: [
        {
          text: "do the shopkeeper voice",
          kind: "request",
          asked: 5,
          likes: 9,
          ideas: [],
        },
      ],
      questions: [],
      objections: [],
      requests: [],
      language: ["telugu"],
    },
    reels: reels(8),
  });

  const view = buildProfileView(toCompetitorView(p), { own: false });
  assert.doesNotMatch(
    view.dna.summary,
    /different space|not enough|provisional|Nothing the search returned/i,
  );
  assert.match(view.dna.summary, /Covers, every week/);
  assert.match(view.dna.summary, /Their usual post reaches/);
  assert.match(view.dna.summary, /Viewers keep asking for/);
  assert.match(view.comparison ?? "", /Compared with 4 accounts/);
  assert.match(view.comparison ?? "", /not enough close/);
  assert.equal(view.nicheVerified, false);
});

test("nicheVerified is true only when the cohort check matched", () => {
  const withVerdict = (verdict: "matches" | "mixed" | "wrong" | "unknown") =>
    plan({
      nicheFit: {
        searched: "telugu music covers",
        score: 0.8,
        agreement: 0.8,
        verdict,
        ok: verdict === "matches",
        accounts: [],
        off: [],
        creatorShape: "singer",
        reasons: [],
      },
    });

  assert.equal(
    buildProfileView(withVerdict("matches"), { own: false }).nicheVerified,
    true,
  );
  assert.equal(
    buildProfileView(withVerdict("mixed"), { own: false }).nicheVerified,
    false,
  );
  assert.equal(
    buildProfileView(withVerdict("wrong"), { own: false }).nicheVerified,
    false,
  );
  assert.equal(
    buildProfileView(plan({ nicheSource: "model" }), { own: false })
      .nicheVerified,
    false,
    "a model guess alone is not verified",
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

test("a stored view accepts a bot estimate and refuses a malformed one", async () => {
  setDataDir(TMP);
  process.env.PROFILE_CACHE_HOURS = "168";
  try {
    const view = buildProfileView(plan({ handle: "estimate_ok", reels: reels(2) }), {
      own: false,
      authenticity: { realPct: 71, sample: 60, confidence: "medium" },
    });
    await saveProfileView("estimate_ok", view);
    const read = await readProfileView("estimate_ok", Date.now());
    assert.deepEqual(read?.view.vitals.botToReal, {
      realPct: 71,
      sample: 60,
      confidence: "medium",
    });

    const dir = profileDir();
    writeFileSync(
      path.join(dir, "estimate_bad.json"),
      JSON.stringify({
        handle: "estimate_bad",
        savedAt: new Date().toISOString(),
        view: {
          ...view,
          handle: "estimate_bad",
          vitals: {
            ...view.vitals,
            botToReal: { realPct: 140, sample: 60, confidence: "medium" },
          },
        },
      }),
    );
    assert.equal(await readProfileView("estimate_bad", Date.now()), null);
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

test("the shared store refuses own and next-move views", async () => {
  setDataDir(TMP);
  process.env.PROFILE_CACHE_HOURS = "168";
  try {
    const own = buildProfileView(
      plan({
        reels: reels(2),
        nextMove: {
          title: "Post the reaction",
          why: "Your best post was 5x your usual.",
          action: "Start on the reaction.",
          evidence: [],
          confidence: 0.8,
          basis: "your own posts",
          checkOn: "next week",
        },
      }),
      { own: true },
    );

    await assert.rejects(
      () => saveProfileView("fixture", own),
      /competitor views only/,
    );

    // Even a hand-written file is rejected on read: the shared artifact is a
    // neutral competitor view, never the owner's next move.
    const dir = profileDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "fixture.json"),
      JSON.stringify({
        handle: "fixture",
        savedAt: new Date().toISOString(),
        view: own,
      }),
    );
    assert.equal(await readProfileView("fixture", Date.now()), null);

    const neutral = buildProfileView(plan({ reels: reels(2) }), { own: false });
    assert.equal(await readProfileView("fixture", Date.now()), null);
    writeFileSync(
      path.join(dir, "fixture.json"),
      JSON.stringify({
        handle: "fixture",
        savedAt: new Date().toISOString(),
        view: { ...neutral, nextMove: own.nextMove },
      }),
    );
    assert.equal(await readProfileView("fixture", Date.now()), null);
  } finally {
    restoreDir();
  }
});

test("the shared store refuses a non-Instagram idea", async () => {
  setDataDir(TMP);
  try {
    const view = buildProfileView(
      plan({ reels: reels(2), competitors: [competitor("alpha", 2400000)] }),
      { own: false },
    );
    await assert.rejects(
      () =>
        saveProfileView("fixture", {
          ...view,
          ideas: [{ ...view.ideas[0], platform: "youtube" as never }],
        }),
      /not Instagram/,
    );
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
        competitors: [competitor("alpha", 2400000)],
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

test("runProfileRead stores the estimate and the video readings", async () => {
  setDataDir(TMP);
  try {
    const stored: ProfileView[] = [];
    const p = plan({
      handle: "estimated_fixture",
      account: { followers: 5000, bio: "Covers, every week" },
      reels: reels(6),
    });
    const reader = {
      async read() {
        return {
          basis: "video" as const,
          hookSeconds: 1.2,
          hookType: "visual" as const,
          why: ["Wide shot first"],
        };
      },
    };

    await runProfileRead(
      { handle: "estimated_fixture" },
      {
        runPlan: async () => ({ plan: p, spent: 6 }),
        saveView: async (_h, v) => {
          stored.push(v);
        },
        authenticity: {
          pages: 4,
          read: async () => null,
          save: async () => undefined,
          account: async () => ({ pk: "42", isPrivate: false }),
          sample: async () => cleanFollowers(60),
        },
        reader,
      },
    );

    const view = stored[0];
    assert.ok(view, "the read stored a view");
    assert.deepEqual(view.vitals.botToReal, {
      realPct: 100,
      sample: 60,
      confidence: "low",
    });
    const cards = [...view.winners, ...view.flops];
    assert.equal(cards.length, 6);
    for (const card of cards) {
      assert.equal(card.basis, "video");
      assert.equal(card.why[0], "Hook: visual, lands at 1.2 s");
    }
  } finally {
    restoreDir();
  }
});

test("a bought estimate is cached for the next read", async () => {
  setDataDir(TMP);
  try {
    let sampled = 0;
    const p = plan({
      handle: "cached_estimate_fixture",
      account: { followers: 5000 },
      reels: reels(2),
    });
    const deps = {
      runPlan: async () => ({ plan: p, spent: 6 }),
      saveView: async (_h: string, _v: ProfileView) => undefined,
    };

    await runProfileRead(
      { handle: "cached_estimate_fixture" },
      {
        ...deps,
        authenticity: {
          pages: 4,
          account: async () => ({ pk: "42", isPrivate: false }),
          sample: async () => {
            sampled += 1;
            return cleanFollowers(60);
          },
        },
      },
    );
    const cached = await readAuthenticity("cached_estimate_fixture");
    assert.deepEqual(cached, { realPct: 100, sample: 60, confidence: "low" });

    let stored: ProfileView | null = null;
    await runProfileRead(
      { handle: "cached_estimate_fixture" },
      {
        runPlan: async () => ({ plan: p, spent: 6 }),
        saveView: async (_h, v) => {
          stored = v;
        },
        authenticity: {
          pages: 4,
          account: async () => {
            throw new Error("should not be asked: the cache answers");
          },
          sample: async () => {
            throw new Error("should not be sampled twice");
          },
        },
      },
    );
    assert.equal(sampled, 1);
    assert.deepEqual(stored?.vitals.botToReal, cached);
  } finally {
    restoreDir();
  }
});

test("a failing sample or reader never fails the read", async () => {
  const stored: ProfileView[] = [];
  const p = plan({ account: { followers: 5000 }, reels: reels(6) });

  const result = await runProfileRead(
    { handle: "fragile_fixture" },
    {
      runPlan: async () => ({ plan: p, spent: 6 }),
      saveView: async (_h, v) => {
        stored.push(v);
      },
      authenticity: {
        pages: 4,
        read: async () => null,
        save: async () => undefined,
        account: async () => ({ pk: "42", isPrivate: false }),
        sample: async () => {
          throw new Error("vendor down");
        },
      },
      reader: {
        async read() {
          throw new Error("reader down");
        },
      },
    },
  );

  assert.equal(result.handle, "fragile_fixture");
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.vitals.botToReal, null);
  assert.equal(stored[0]?.winners.length, 3);
  for (const card of [...(stored[0]?.winners ?? []), ...(stored[0]?.flops ?? [])]) {
    assert.equal(card.basis, "captions");
  }
});

test("the sample and account calls are inside the measured vendor spend", async () => {
  const keys = [
    "HIKERAPI_KEY",
    "HIKERAPI_USD_PER_CALL",
    "APIFY_TOKEN",
    "SOCIALCRAWL_API_KEY",
    "SCRAPECREATORS_API_KEY",
    "YOUTUBE_WEB",
    "DATA_PROVIDER",
    "CREDIT_BUDGET_USD",
  ] as const;
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]])) as Record<
    string,
    string | undefined
  >;
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  const fixture = readFileSync(
    path.join(process.cwd(), "lib/providers/__fixtures__/hikerapi/followers_chunk.json"),
    "utf8",
  );

  process.env.HIKERAPI_KEY = "test-key";
  process.env.HIKERAPI_USD_PER_CALL = "0.02";
  delete process.env.APIFY_TOKEN;
  delete process.env.SOCIALCRAWL_API_KEY;
  delete process.env.SCRAPECREATORS_API_KEY;
  delete process.env.YOUTUBE_WEB;
  delete process.env.DATA_PROVIDER;
  process.env.CREDIT_BUDGET_USD = "100";

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("/v2/user/by/username")) {
      return new Response(
        JSON.stringify({
          status: true,
          user: {
            username: "spend_fixture",
            pk: 32334432364,
            id: "32334432364",
            follower_count: 5000,
            is_private: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/v1/user/followers/chunk")) {
      return new Response(fixture, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  resetCreditLedger();
  const spentBefore = creditLedger().lifetimeUsd;
  try {
    const p = plan({
      handle: "spend_fixture",
      account: { followers: 5000 },
      reels: reels(4),
    });
    await runProfileRead(
      { handle: "spend_fixture" },
      {
        runPlan: async () => ({ plan: p, spent: 6 }),
        saveView: async () => undefined,
        authenticity: { pages: 4, read: async () => null },
      },
    );

    const delta = creditLedger().lifetimeUsd - spentBefore;
    assert.ok(delta >= 0.04, `the two calls cost ${delta}`);
    assert.ok(seen.some((u) => u.includes("/v2/user/by/username")));
    assert.ok(seen.some((u) => u.includes("/v1/user/followers/chunk")));
  } finally {
    globalThis.fetch = realFetch;
    for (const k of keys) {
      const value = before[k];
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  }
});

test("follower sampling is dormant by default: no vendor call and no estimate", async () => {
  setDataDir(TMP);
  const savedCap = process.env.AUTH_SAMPLE_PAGES;
  delete process.env.AUTH_SAMPLE_PAGES;
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.push(String(input));
    throw new Error("dormant sampling must not reach the network");
  }) as typeof fetch;

  try {
    const stored: ProfileView[] = [];
    const p = plan({
      handle: "dormant_fixture",
      account: { followers: 5000 },
      reels: reels(4),
    });

    await runProfileRead(
      { handle: "dormant_fixture" },
      {
        runPlan: async () => ({ plan: p, spent: 6 }),
        saveView: async (_h, v) => {
          stored.push(v);
        },
      },
    );

    assert.equal(seen.length, 0, "the default cap of 0 makes zero vendor calls");
    assert.equal(stored[0]?.vitals.botToReal, null);
  } finally {
    globalThis.fetch = realFetch;
    if (savedCap === undefined) delete process.env.AUTH_SAMPLE_PAGES;
    else process.env.AUTH_SAMPLE_PAGES = savedCap;
    restoreDir();
  }
});

test("with no Gemini key the video model is never used and cards stay captions", async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.push(String(input));
    throw new Error("captions-only reads must not reach the network");
  }) as typeof fetch;

  try {
    assert.equal(
      configuredReader(),
      CaptionReader,
      "without a key the configured reader is the caption reader itself",
    );

    const stored: ProfileView[] = [];
    const p = plan({ handle: "captions_only_fixture", reels: reels(4) });
    await runProfileRead(
      { handle: "captions_only_fixture" },
      {
        runPlan: async () => ({ plan: p, spent: 6 }),
        saveView: async (_h, v) => {
          stored.push(v);
        },
      },
    );

    assert.equal(seen.length, 0, "no MP4 download and no model call");
    const cards = [...(stored[0]?.winners ?? []), ...(stored[0]?.flops ?? [])];
    assert.equal(cards.length, 4);
    for (const card of cards) {
      assert.equal(card.basis, "captions");
      assert.equal(
        reelBasisLine(card.basis),
        "From captions and numbers; video not watched.",
      );
    }
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  }
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
