// Creator profile capture: the upsert itself runs on in-memory PGlite, and the
// own/competitor write boundary is exercised through runPlanBuild's injected
// deps (the same seam the plan route uses).
//   npm run test:file -- test-creator-profile
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../lib/migrate";
import { closeDb, setDbForTests, resetDbForTests } from "../lib/db";
import type { Queryable } from "../lib/db";
import { saveCreatorProfile } from "../lib/creatorProfile";
import { runPlanBuild, type PlanBuildDeps } from "../lib/planRequest";
import type { AnalyseResult } from "../lib/plan";
import type { NicheResearch } from "../lib/niche";
import type { GrowthPlan } from "../lib/types";

// PGlite's own query type is close to but not exactly Queryable; adapt it.
function asQueryable(pg: PGlite): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const res = await pg.query<T>(sql, params as never[]);
      const one = Array.isArray(res) ? res[res.length - 1] : res;
      return { rows: one.rows as T[] };
    },
  };
}

// Fresh PGlite with the schema applied and one user inserted; setDbForTests
// routes every creator-profile call in the block to it.
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

interface ProfileRow {
  user_id: string;
  handle: string | null;
  niche: string | null;
  followers: number | null;
  platform: string | null;
  updated_at: string | Date | null;
}

async function profileRows(q: Queryable, userId: string): Promise<ProfileRow[]> {
  const { rows } = await q.query<ProfileRow>(
    "SELECT user_id, handle, niche, followers, platform, updated_at FROM creator_profiles WHERE user_id = $1",
    [userId],
  );
  return rows;
}

/** Counts calls, so a test can prove a write path was never entered. */
function spy<T extends (...args: never[]) => unknown>(fn: T) {
  let calls = 0;
  const wrapped = ((...args: Parameters<T>) => {
    calls += 1;
    return fn(...args);
  }) as T;
  return { fn: wrapped, calls: () => calls };
}

function fixturePlan(overrides: Partial<GrowthPlan> = {}): GrowthPlan {
  return {
    handle: "fixture_creator",
    niche: "telugu comedy",
    platform: "instagram",
    generatedAt: "2026-11-02T10:00:00.000Z",
    archetype: {
      id: "comedy",
      label: "comedian",
      blurb: "Short spoken jokes to camera.",
      songLed: false,
      recommendation: "hooks",
    },
    cohort: {
      accounts: 0,
      basis: "everyone in this space (0 accounts)",
      nicheMedianViews: 0,
      sizeMatched: false,
    },
    account: { followers: 8200 },
    standing: {
      followers: 8200,
      medianViews: 0,
      bestViews: 0,
      reelsRead: 0,
      vsNiche: 0,
      percentile: 0,
      accountRead: true,
    },
    diagnosis: "Fixture plan.",
    gaps: [],
    moves: [],
    questions: [],
    ...overrides,
  };
}

function fixtureResearch(): NicheResearch {
  return {
    query: "telugu comedy",
    fetchedAt: "2026-11-02T10:00:00.000Z",
    cached: true,
    credits: { spent: 0, calls: 0, remaining: null },
    accounts: [],
    nicheMedianViews: 0,
    reels: 0,
    totalReels: 0,
    own: null,
    hashtags: [],
    errors: [],
    payload: [],
    language: { wanted: "telugu", basis: "own", kept: 0, seen: 0, dropped: 0 },
  } as unknown as NicheResearch;
}

function fixtureAnalysis(plan: GrowthPlan): AnalyseResult {
  return {
    plan,
    niche: { query: "telugu comedy", audience: "", source: "model" },
    nicheFit: {
      searched: "telugu comedy",
      score: 0.8,
      agreement: 0.8,
      verdict: "matches",
      ok: true,
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
      blurb: "Short spoken jokes to camera.",
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

function baseDeps(plan: GrowthPlan, overrides: Partial<PlanBuildDeps> = {}): PlanBuildDeps {
  return {
    analyseHandle: async () => fixtureAnalysis(plan),
    savePlan: async () => undefined,
    getProfile: async () => null,
    runPipeline: async () => undefined,
    scheduleAfter: () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

test("two saves for one user leave one row with the latest handle and niche", async () => {
  await withFreshDb(async (q, userId) => {
    await saveCreatorProfile(userId, {
      handle: "@First.Handle",
      niche: "  telugu comedy  ",
      followers: 1000,
    });
    await saveCreatorProfile(userId, {
      handle: "Second",
      niche: "fitness",
      followers: undefined,
    });

    const rows = await profileRows(q, userId);
    assert.equal(rows.length, 1, "one row per user");
    assert.equal(rows[0]!.user_id, userId);
    assert.equal(rows[0]!.handle, "second");
    assert.equal(rows[0]!.niche, "fitness");
    assert.equal(rows[0]!.followers, 1000, "an undefined followers keeps the known value");
    assert.equal(rows[0]!.platform, "instagram");
    assert.ok(rows[0]!.updated_at, "updated_at is written");
  });
});

test("an invalid handle throws and writes nothing", async () => {
  await withFreshDb(async (q, userId) => {
    await assert.rejects(
      () => saveCreatorProfile(userId, { handle: "not a handle!" }),
      /handle/i,
    );
    assert.equal((await profileRows(q, userId)).length, 0);
  });
});

test("negative, NaN and infinite followers are ignored; finite numbers round", async () => {
  await withFreshDb(async (q, userId) => {
    await saveCreatorProfile(userId, { handle: "creator", followers: 500 });

    await saveCreatorProfile(userId, { handle: "creator", followers: -12 });
    await saveCreatorProfile(userId, { handle: "creator", followers: NaN });
    await saveCreatorProfile(userId, { handle: "creator", followers: Infinity });
    assert.equal((await profileRows(q, userId))[0]!.followers, 500);

    await saveCreatorProfile(userId, { handle: "creator", followers: 1500.6 });
    assert.equal((await profileRows(q, userId))[0]!.followers, 1501);
  });
});

test("niche is trimmed, truncated to 120 characters, and empty becomes undefined", async () => {
  await withFreshDb(async (q, userId) => {
    await saveCreatorProfile(userId, { handle: "creator", niche: "   " });
    assert.equal((await profileRows(q, userId))[0]!.niche, null);

    const long = "x".repeat(200);
    await saveCreatorProfile(userId, { handle: "creator", niche: long });
    const stored = (await profileRows(q, userId))[0]!.niche;
    assert.equal(stored?.length, 120);
    assert.equal(stored, "x".repeat(120));

    // An empty string is undefined, and undefined never erases a known niche.
    await saveCreatorProfile(userId, { handle: "creator", niche: "   " });
    assert.equal((await profileRows(q, userId))[0]!.niche, "x".repeat(120));
  });
});

test("platform defaults to instagram, accepts youtube, and rejects anything else", async () => {
  await withFreshDb(async (q, userId) => {
    await saveCreatorProfile(userId, { handle: "creator" });
    assert.equal((await profileRows(q, userId))[0]!.platform, "instagram");

    await saveCreatorProfile(userId, { handle: "creator", platform: "youtube" });
    assert.equal((await profileRows(q, userId))[0]!.platform, "youtube");

    await assert.rejects(
      () =>
        saveCreatorProfile(userId, {
          handle: "creator",
          platform: "tiktok" as never,
        }),
      /platform/i,
    );
    assert.equal((await profileRows(q, userId))[0]!.platform, "youtube");
  });
});

test("own mode saves the creator profile after the plan", async () => {
  const plan = fixturePlan();
  const order: string[] = [];
  const saveCreatorProfile = spy(async (_plan: GrowthPlan) => {
    order.push("profile");
  });

  const deps = baseDeps(plan, {
    savePlan: async () => {
      order.push("plan");
    },
    saveCreatorProfile: saveCreatorProfile.fn,
  });

  await runPlanBuild(
    { mode: "own", handle: "fixture_creator", shallow: true, store: null as never },
    deps,
  );

  assert.equal(saveCreatorProfile.calls(), 1);
  assert.deepEqual(order, ["plan", "profile"], "the plan is saved before the profile");
});

test("competitor mode never saves the creator profile", async () => {
  const plan = fixturePlan();
  const saveCreatorProfile = spy(async (_plan: GrowthPlan) => undefined);
  const savePlan = spy(async (_plan: GrowthPlan) => undefined);

  const deps = baseDeps(plan, {
    savePlan: savePlan.fn,
    saveCreatorProfile: saveCreatorProfile.fn,
  });

  await runPlanBuild(
    {
      mode: "competitor",
      handle: "fixture_creator",
      shallow: true,
      store: null as never,
    },
    deps,
  );

  assert.equal(saveCreatorProfile.calls(), 0, "a competitor read writes no profile");
  assert.equal(savePlan.calls(), 0, "a competitor read saves no plan");
});

test("a failed profile save is logged and never fails the plan", async () => {
  const plan = fixturePlan();
  const logged: string[] = [];
  const savePlan = spy(async (_plan: GrowthPlan) => undefined);

  const deps = baseDeps(plan, {
    savePlan: savePlan.fn,
    saveCreatorProfile: async () => {
      throw new Error("database was busy");
    },
    logError: (err) => {
      logged.push((err as Error).message);
    },
  });

  const result = await runPlanBuild(
    { mode: "own", handle: "fixture_creator", shallow: true, store: null as never },
    deps,
  );

  assert.equal(result.plan.handle, "fixture_creator");
  assert.equal(savePlan.calls(), 1, "the paid plan was still saved");
  assert.deepEqual(logged, ["database was busy"]);
});

test.after(() => {
  resetDbForTests();
});

test("closeDb is a no-op in this suite", async () => {
  await closeDb();
});
