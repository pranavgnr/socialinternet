// Competitor read: a public account can be read without touching the visitor's
// own plan, idea feed or niche memory, and the response carries no advice
// addressed to that account's owner.
//   npm run test:file -- test-competitor
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { looksLikeHandle } from "../lib/handle";
import { neutralisePerson, toCompetitorView } from "../lib/competitor";
import {
  MODE_ERROR,
  parsePlanMode,
  planModeRejection,
  runPlanBuild,
  type PlanBuildDeps,
} from "../lib/planRequest";
import { createStore } from "../lib/store";
import type { AnalyseResult } from "../lib/plan";
import type { NicheResearch } from "../lib/niche";
import type { GrowthPlan, Profile, RawReel } from "../lib/types";

/** A useful plan with every optional piece filled, so a test can prove what was removed. */
function fullPlan(overrides: Partial<GrowthPlan> = {}): GrowthPlan {
  return {
    handle: "fixture_competitor",
    niche: "telugu comedy",
    platform: "instagram",
    accountPlatform: "instagram",
    generatedAt: "2026-11-02T10:00:00.000Z",
    archetype: {
      id: "comedy",
      label: "comedian",
      blurb: "You tell short, spoken jokes to camera.",
      songLed: false,
      recommendation: "hooks",
    },
    cohort: {
      accounts: 12,
      basis: "accounts about your size (8.2k followers)",
      nicheMedianViews: 12000,
      sizeMatched: true,
    },
    account: { followers: 8200, bio: "Your jokes in telugu", category: "Comedian" },
    standing: {
      followers: 8200,
      medianViews: 8000,
      bestViews: 40000,
      reelsRead: 10,
      vsNiche: 0.7,
      percentile: 0.4,
      accountRead: true,
      postsRead: true,
      unreadReason: "we could not read your recent posts",
    },
    diagnosis: "You post less often than accounts your size.",
    gaps: [{ label: "your usual post", you: "8k", cohort: "12k" }],
    moves: [
      {
        id: "move-1",
        priority: 1,
        title: "Open on the reaction",
        why: "Your best post was 5x your usual.",
        action: "Film the reaction before the setup.",
        evidence: [],
      },
    ],
    questions: ["what should I post next"],
    nextMove: {
      title: "Post the reaction to a stranger's line",
      why: "Your best post was 5x your usual.",
      action: "Start the reel on the reaction, then explain.",
      evidence: [],
      confidence: 0.8,
      checkOn: "next week",
      basis: "your own posts",
    },
    songs: [{ title: "Fixture song", accounts: 3, multiple: 2.1, why: "Your own audience responded", evidence: [] }],
    formats: [{ id: "f1", label: "Reaction", what: "react first", accounts: 4, posts: 5, multiple: 1.8, evidence: [] }],
    hooks: [{ id: "h1", label: "A question", what: "ask first", accounts: 3, posts: 4, multiple: 2, example: "who else?", evidence: [] }],
    audit: {
      posts: 10,
      watched: 6,
      medianViews: 8000,
      best: { views: 40000, multiple: 5, caption: "your best one", url: "https://instagram.com/p/best" },
      worst: { views: 1200, multiple: 0.15, caption: "you flopped", url: "https://instagram.com/p/worst" },
      cadence: { medianGapDays: 3, longestGapDays: 9, daysSinceLast: 1 },
      shapes: [],
      hookModes: [],
      breadth: 3,
      consistency: 0.4,
      ceiling: 5,
      versusPeers: "You are ahead of 40% of them.",
      gaps: [
        {
          lever: "opening",
          winners: "you said it out loud",
          losers: "you stayed silent",
          support: 3,
          strength: 0.6,
          note: "Your best posts opened on a line.",
        },
      ],
    },
    comments: {
      read: 4,
      posts: 3,
      seeds: [
        { text: "you should do the shopkeeper voice", kind: "request", asked: 3, likes: 12, ideas: ["you could film it"] },
      ],
      questions: ["where did you learn this"],
      requests: ["you should do more"],
      objections: ["you cannot fake this"],
      language: ["your voice", "shopkeeper"],
    },
    hookRead: {
      mode: "spoken",
      share: 0.7,
      sampled: 6,
      basis: "measured",
      sentence: "Your hook is something said out loud.",
      examples: [],
    },
    language: {
      wanted: "telugu",
      basis: "own",
      word: "telugu",
      kept: 10,
      seen: 12,
      dropped: 2,
      caveat: "You should read these as indicative.",
    },
    ...overrides,
  };
}

/**
 * A plan whose every kept prose field is written to the account's owner, as the
 * builder really writes them. Used to prove the competitor view contains no
 * second person anywhere in its serialised form.
 */
function secondPersonPlan(): GrowthPlan {
  return fullPlan({
    niche: "you comedy",
    nicheFit: {
      searched: "you comedy",
      score: 0.8,
      agreement: 0.8,
      verdict: "matches",
      ok: true,
      accounts: [],
      off: [],
      creatorShape: "you comedy",
      creatorLanguage: "your telugu",
      reasons: ["your posts matched this room"],
    },
    archetype: {
      id: "comedy",
      label: "your comedian",
      language: "your telugu",
      blurb: "You tell short jokes to camera.",
      songLed: false,
      recommendation: "hooks",
    },
    cohort: {
      accounts: 12,
      basis: "accounts about your size (8.2k followers)",
      nicheMedianViews: 12000,
      sizeMatched: true,
      platform: "instagram",
    },
    account: {
      followers: 8200,
      bio: "Your jokes in telugu",
      category: "Comedian",
    },
    standing: {
      followers: 8200,
      medianViews: 8000,
      bestViews: 40000,
      reelsRead: 10,
      vsNiche: 0.7,
      percentile: 0.4,
      accountRead: true,
      postsRead: true,
      unreadReason: "we could not read your recent posts",
      readFrom: "instagram",
    },
    audit: {
      posts: 10,
      watched: 6,
      medianViews: 8000,
      best: {
        views: 40000,
        multiple: 5,
        caption: "your best one",
        url: "https://instagram.com/someone",
      },
      worst: {
        views: 1200,
        multiple: 0.15,
        caption: "you flopped",
        url: "https://instagram.com/someone-else",
      },
      cadence: { medianGapDays: 3, longestGapDays: 9, daysSinceLast: 1 },
      shapes: [],
      hookModes: [],
      breadth: 3,
      consistency: 0.4,
      ceiling: 5,
      versusPeers: "You are ahead of 40% of them.",
      gaps: [
        {
          lever: "opening",
          winners: "your spoken line",
          losers: "you stayed silent",
          support: 3,
          strength: 0.6,
          note: "Your best posts opened on a line.",
        },
      ],
    },
    comments: {
      read: 4,
      posts: 3,
      seeds: [
        {
          text: "you should do the shopkeeper voice",
          kind: "request",
          asked: 3,
          likes: 12,
          ideas: ["you could film it"],
        },
      ],
      questions: ["where did you learn this"],
      requests: ["you should do more"],
      objections: ["you cannot fake this"],
      language: ["your voice"],
    },
    language: {
      wanted: "your telugu",
      basis: "own",
      word: "your telugu",
      kept: 10,
      seen: 12,
      dropped: 2,
      caveat: "You should read these as indicative.",
    },
  });
}

function fixtureResearch(): NicheResearch {
  return {
    query: "telugu comedy",
    fetchedAt: "2026-11-02T10:00:00.000Z",
    cached: true,
    credits: { spent: 0, calls: 0, remaining: null },
    accounts: [],
    nicheMedianViews: 12000,
    reels: 10,
    totalReels: 12,
    own: null,
    hashtags: [],
    errors: [],
    payload: [],
    language: { wanted: "telugu", basis: "own", kept: 10, seen: 12, dropped: 2 },
  } as unknown as NicheResearch;
}

function fixtureAnalysis(plan: GrowthPlan): AnalyseResult {
  return {
    plan,
    niche: { query: "telugu comedy", audience: "", source: "model" },
    nicheFit: {
      ok: true,
      verdict: "matches",
      searched: "telugu comedy",
      score: 0.8,
      agreement: 0.8,
      accounts: [],
      off: [],
      creatorShape: "comedy",
      reasons: [],
    },
    research: fixtureResearch(),
    own: {
      handle: plan.handle,
      platform: "instagram",
      reels: [],
      cached: true,
    },
    archetype: {
      id: "comedy",
      label: "comedian",
      blurb: "You tell short, spoken jokes to camera.",
      songLed: false,
      recommendation: "hooks",
      confidence: 0.8,
      language: "telugu",
      hookLed: true,
      formatLed: false,
      evidence: [],
    } as unknown as AnalyseResult["archetype"],
    seedReels: [],
  } as unknown as AnalyseResult;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "c101-competitor-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Counts calls; a test can prove a write path was never entered. */
function spy<T extends (...args: never[]) => unknown>(fn: T) {
  let calls = 0;
  const wrapped = ((...args: Parameters<T>) => {
    calls += 1;
    return fn(...args);
  }) as T;
  return { fn: wrapped, calls: () => calls };
}

test("mode defaults to own and an unknown value is refused at 400", () => {
  assert.equal(parsePlanMode(undefined), "own");
  assert.equal(parsePlanMode("own"), "own");
  assert.equal(parsePlanMode("competitor"), "competitor");
  assert.equal(planModeRejection(undefined), null);
  assert.equal(planModeRejection("competitor"), null);

  // These are unknown values, not a reason to quietly build an own plan. The
  // route returns this refusal before `take()`, `gate()` or any pull, so the
  // request cannot spend a credit.
  for (const bad of ["COMPETITOR", "", null, 1, true, {}]) {
    assert.equal(parsePlanMode(bad), null);
    assert.deepEqual(planModeRejection(bad), { status: 400, error: MODE_ERROR });
  }
});

test("looksLikeHandle only accepts @handles and instagram profile URLs", () => {
  assert.equal(looksLikeHandle("@foo"), true);
  assert.equal(looksLikeHandle("  @Foo.Bar  "), true);
  assert.equal(looksLikeHandle("https://instagram.com/foo"), true);
  assert.equal(looksLikeHandle("https://www.instagram.com/foo/"), true);
  assert.equal(looksLikeHandle("instagram.com/foo"), true);

  assert.equal(looksLikeHandle("cooking"), false);
  assert.equal(looksLikeHandle("best reels"), false);
  assert.equal(looksLikeHandle("foo bar"), false);
  assert.equal(looksLikeHandle("https://instagram.com/p/abc/"), false);
  assert.equal(looksLikeHandle(""), false);
});

test("toCompetitorView strips advice and keeps the measured read", () => {
  const view = toCompetitorView(fullPlan());

  // Personalised advice is gone, including from the serialised response body.
  assert.equal(view.nextMove, undefined);
  assert.deepEqual(view.moves, []);
  assert.equal(view.diagnosis, "");
  assert.equal(view.songs, undefined);
  assert.equal(view.formats, undefined);
  assert.equal(view.hooks, undefined);
  assert.equal(view.hookRead, undefined);
  assert.deepEqual(view.gaps, []);
  const wire = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
  assert.equal("nextMove" in wire, false);
  assert.equal("moves" in wire, true);
  assert.deepEqual(wire.moves, []);

  // Authored prose survives, translated to the account.
  assert.equal(view.standing.medianViews, 8000);
  assert.equal(view.standing.unreadReason, "we could not read their recent posts");
  assert.equal(view.archetype.label, "comedian");
  assert.equal(view.archetype.blurb, "They tell short, spoken jokes to camera.");
  assert.equal(view.cohort.basis, "accounts about their size (8.2k followers)");
  assert.equal(view.audit?.gaps.length, 1);
  assert.equal(
    view.audit?.gaps[0]?.note,
    "Their best posts opened on a line.",
  );
  assert.equal(view.audit?.gaps[0]?.winners, "they said it out loud");
  assert.equal(view.audit?.gaps[0]?.losers, "they stayed silent");
  assert.equal(view.audit?.versusPeers, "They are ahead of 40% of them.");

  // Verbatim evidence survives byte-for-byte: the account's caption, the
  // audience's comment and the profile bio are quotes, not our prose.
  assert.equal(view.audit?.best.caption, "your best one");
  assert.equal(view.audit?.worst.caption, "you flopped");
  assert.equal(
    view.comments?.seeds[0]?.text,
    "you should do the shopkeeper voice",
  );
  assert.equal(view.account?.bio, "Your jokes in telugu");

  // Comment ideas are advice rather than either evidence or a theme.
  assert.deepEqual(view.comments?.seeds[0]?.ideas, []);
});

test("neutralisePerson rewrites second person, preserving case and apostrophes", () => {
  assert.equal(
    neutralisePerson("Your best posts opened on a line."),
    "Their best posts opened on a line.",
  );
  assert.equal(
    neutralisePerson("accounts about your size (8.2k followers)"),
    "accounts about their size (8.2k followers)",
  );
  assert.equal(
    neutralisePerson("You're ahead of most of them."),
    "They're ahead of most of them.",
  );
  assert.equal(
    neutralisePerson("You’re ahead of most of them."),
    "They’re ahead of most of them.",
  );
  assert.equal(
    neutralisePerson("You've done it; you'll see. Yours, yourself."),
    "They've done it; they'll see. Theirs, themselves.",
  );
  assert.equal(neutralisePerson("YOU'RE SURE"), "THEY'RE SURE");
  // Substrings are not pronouns: a young youtuber stays a young youtuber.
  assert.equal(neutralisePerson("a young youtuber"), "a young youtuber");
});

test("URLs, handles and identifier keys are never rewritten", () => {
  const base = fullPlan();
  const plan = fullPlan({
    handle: "@your_name",
    audit: {
      ...base.audit!,
      best: {
        ...base.audit!.best,
        caption: "your best one",
        url: "https://instagram.com/youandme",
      },
    },
    comments: {
      ...base.comments!,
      language: ["@your_name", "https://instagram.com/youandme"],
    },
  });

  const view = toCompetitorView(plan);
  assert.equal(view.handle, "@your_name");
  assert.equal(view.audit?.best.url, "https://instagram.com/youandme");
  assert.deepEqual(view.comments?.language, [
    "@your_name",
    "https://instagram.com/youandme",
  ]);
  // The caption is a quote and stays exactly as the account wrote it.
  assert.equal(view.audit?.best.caption, "your best one");
});

test("captions are verbatim evidence and are never rewritten", () => {
  const base = fullPlan();
  const view = toCompetitorView(
    fullPlan({
      audit: {
        ...base.audit!,
        best: { ...base.audit!.best, caption: "you need to watch this" },
        worst: { ...base.audit!.worst, caption: "your mother was right" },
      },
    }),
  );

  assert.equal(view.audit?.best.caption, "you need to watch this");
  assert.equal(view.audit?.worst.caption, "your mother was right");
});

test("audience comments are verbatim evidence and are never rewritten", () => {
  const base = fullPlan();
  const view = toCompetitorView(
    fullPlan({
      comments: {
        ...base.comments!,
        seeds: [
          {
            text: "you need to watch this",
            kind: "request",
            asked: 1,
            likes: 2,
            ideas: ["you could film it"],
          },
        ],
        questions: ["can you show the strumming pattern?"],
        objections: ["you missed the point"],
        requests: ["you should do part 2"],
        praise: ["you are the best"],
        language: ["you", "your"],
      },
    }),
  );

  assert.equal(view.comments?.seeds[0]?.text, "you need to watch this");
  assert.deepEqual(view.comments?.seeds[0]?.ideas, []);
  assert.deepEqual(view.comments?.questions, [
    "can you show the strumming pattern?",
  ]);
  assert.deepEqual(view.comments?.objections, ["you missed the point"]);
  assert.deepEqual(view.comments?.requests, ["you should do part 2"]);
  assert.deepEqual(view.comments?.praise, ["you are the best"]);
  assert.deepEqual(view.comments?.language, ["you", "your"]);
});

test("the profile bio is verbatim evidence and is never rewritten", () => {
  const view = toCompetitorView(
    fullPlan({
      account: {
        followers: 8200,
        bio: "Your jokes in telugu — you know the one",
        category: "Comedian",
      },
    }),
  );

  assert.equal(
    view.account?.bio,
    "Your jokes in telugu — you know the one",
  );
});

test("a competitor plan has no second person in authored prose", () => {
  const view = toCompetitorView(secondPersonPlan());

  const SECOND_PERSON = /\b(you|your|yours|you're|you've|you'll|yourself)\b/i;

  /**
   * Verbatim fields are excluded from this walk on purpose. They are quotes
   * and are *expected* to still say "you"; rewriting them would falsify the
   * evidence. Everything else in the result is authored prose and must not
   * contain second person.
   */
  const VERBATIM_KEYS = new Set([
    "caption",
    "bio",
    "text",
    "username",
    "author",
    "title",
  ]);
  const VERBATIM_PATHS: readonly (readonly string[])[] = [
    // a search phrase or language label is input, not prose
    ["niche"],
    ["nicheFit", "searched"],
    ["language", "wanted"],
    ["language", "word"],
    // the audience's own words
    ["comments", "questions", "*"],
    ["comments", "objections", "*"],
    ["comments", "requests", "*"],
    ["comments", "praise", "*"],
    ["comments", "language", "*"],
    ["comments", "seeds", "*", "text"],
    // links and the account's own handle
    ["audit", "best", "url"],
    ["audit", "worst", "url"],
    ["handle"],
  ];

  const pathMatches = (
    pattern: readonly string[],
    path: readonly string[],
  ): boolean =>
    pattern.length === path.length &&
    pattern.every((segment, i) => segment === "*" || segment === path[i]);

  const isVerbatim = (path: readonly string[]): boolean =>
    path.some((segment) => VERBATIM_KEYS.has(segment)) ||
    VERBATIM_PATHS.some((pattern) => pathMatches(pattern, path));

  const collect = (
    value: unknown,
    path: string[] = [],
    out: { path: string[]; text: string }[] = [],
  ): { path: string[]; text: string }[] => {
    if (typeof value === "string") {
      out.push({ path, text: value });
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, [...path, "*"], out);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        collect(item, [...path, key], out);
      }
    }
    return out;
  };

  const strings = collect(view);
  assert.ok(strings.length > 10, "the walk saw the whole plan");
  for (const { path, text } of strings) {
    if (isVerbatim(path)) continue;
    // Opaque values are never prose: https URLs and @handles.
    if (/^https?:\/\//i.test(text) || text.startsWith("@")) continue;
    assert.doesNotMatch(
      text,
      SECOND_PERSON,
      `${path.join(".")} still addresses the visitor: ${text}`,
    );
  }

  // Authored prose is the class that must have changed.
  assert.equal(
    view.audit?.gaps[0]?.note,
    "Their best posts opened on a line.",
  );
  assert.equal(
    view.cohort.basis,
    "accounts about their size (8.2k followers)",
  );
  assert.equal(view.standing.unreadReason, "we could not read their recent posts");
  assert.equal(view.archetype.blurb, "They tell short jokes to camera.");
  assert.deepEqual(view.nicheFit?.reasons, ["their posts matched this room"]);

  // Verbatim text is the class that must not have changed.
  assert.equal(view.audit?.best.caption, "your best one");
  assert.equal(
    view.comments?.seeds[0]?.text,
    "you should do the shopkeeper voice",
  );
  assert.equal(view.account?.bio, "Your jokes in telugu");
});

test("a competitor read never writes the visitor's plan or idea feed", async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir);
    const visitorPlan = fullPlan({
      handle: "visitor_own",
      moves: [],
      diagnosis: "My own plan.",
    });
    // A stored plan never carries an explicit `undefined` key; writing one
    // would make the round-trip comparison fail for the wrong reason.
    delete visitorPlan.nextMove;
    await store.savePlan(visitorPlan);

    const competitorPlan = fullPlan({
      handle: "fixture_competitor",
      nextMove: { title: "Their next move", why: "their why", action: "their action", evidence: [], confidence: 0.9, checkOn: "soon", basis: "your own posts" },
    });

    const savePlan = spy(store.savePlan);
    const runPipeline = spy(async () => undefined);
    const scheduleAfter = spy((_fn: () => Promise<void>) => undefined);
    const getProfile = spy(async () => null as Profile | null);

    const deps: PlanBuildDeps = {
      analyseHandle: async () => fixtureAnalysis(competitorPlan),
      savePlan: savePlan.fn,
      getProfile: getProfile.fn,
      runPipeline: runPipeline.fn as unknown as PlanBuildDeps["runPipeline"],
      scheduleAfter: scheduleAfter.fn,
      logError: () => undefined,
    };

    const result = await runPlanBuild(
      {
        mode: "competitor",
        handle: "fixture_competitor",
        force: false,
        shallow: true,
        store,
      },
      deps,
    );

    assert.equal(result.plan.nextMove, undefined);
    assert.deepEqual(result.plan.moves, []);
    assert.equal(savePlan.calls(), 0, "competitor reads do not save a visitor plan");
    assert.equal(getProfile.calls(), 0, "no profile/signals/ideas work is started");
    assert.equal(runPipeline.calls(), 0, "the idea feed is never rebuilt");
    assert.equal(scheduleAfter.calls(), 0, "nothing is queued after the response");

    // The visitor's saved own plan is byte-for-byte the one they already had.
    assert.deepEqual(await store.getPlan(), visitorPlan);
  });
});

test("own mode still saves the plan and queues the idea rebuild", async () => {
  await withTempDir(async (dir) => {
    const store = createStore(dir);
    const ownPlan = fullPlan({ handle: "visitor_own" });

    const savePlan = spy(store.savePlan);
    const runPipeline = spy(async (_args: unknown) => undefined);
    const scheduled: (() => Promise<void>)[] = [];
    const scheduleAfter = spy((fn: () => Promise<void>) => {
      scheduled.push(fn);
    });

    const deps: PlanBuildDeps = {
      analyseHandle: async () => fixtureAnalysis(ownPlan),
      savePlan: savePlan.fn,
      getProfile: async () => null,
      runPipeline: runPipeline.fn as unknown as PlanBuildDeps["runPipeline"],
      scheduleAfter: scheduleAfter.fn,
      logError: () => undefined,
    };

    const result = await runPlanBuild(
      { mode: "own", handle: "visitor_own", shallow: true, store },
      deps,
    );

    assert.equal(result.plan.nextMove?.title, "Post the reaction to a stranger's line");
    assert.equal(savePlan.calls(), 1);
    assert.equal(scheduleAfter.calls(), 1);
    assert.equal(runPipeline.calls(), 0, "the rebuild only runs when the queued job runs");
    assert.deepEqual(await store.getPlan(), ownPlan);

    await scheduled[0]!();
    assert.equal(runPipeline.calls(), 1);
  });
});
