import { adapt } from "./adapt";
import { converge } from "./converge";
import { demoReels, demoSoundStats } from "./fixtures";
import { checkBalance, deriveSoundStats, harvestAll, resetCreditLedger } from "./harvest";
import { decompose, topicPhrase } from "./patterns";
import { rank } from "./rank";
import { capPerAccount, keepRelevant, nicheVocab } from "./relevance";
import { filterSignals, scoreSignals } from "./score";
import { store } from "./store";
import type { Store } from "./store";
import type { Profile, RawReel, RunLog, ScoredSignal, SoundStats } from "./types";

export function defaultProfile(): Profile {
  return {
    niche: "AI tools and automation for solo operators",
    audience:
      "solo founders and one-person agencies who want to ship with AI instead of hiring",
    offer: "done-with-you automation builds",
    pillars: [
      "automation walkthroughs",
      "AI tool teardowns",
      "build in public numbers",
      "client systems and SOPs",
    ],
    voice:
      "plain, specific, slightly dry. Real numbers, no hype, no guru energy.",
    bannedWords: ["game-changer", "unlock", "dive in", "revolutionise"],
    constraints: { solo: true, maxSeconds: 30, setting: "desk, screen recording" },
    // Verified real accounts in this niche. One credit each per run.
    benchmarks: [
      { handle: "forgemind_ai", platform: "instagram", note: "n8n/automation demos, high views per reel" },
      { handle: "nick_saraev", platform: "instagram", note: "AI tool workflows" },
      { handle: "haloziq", platform: "instagram", note: "same niche, peer tier" },
      { handle: "juliensnsn.ai", platform: "instagram", note: "AI automation" },
      { handle: "artanov.tech", platform: "instagram", note: "AI/dev tools" },
    ],
    keywords: ["n8n workflow", "ai automation", "claude code"],
    ownWinners: [],
    commentQuestions: [],
  };
}

export function liveMode(): boolean {
  return Boolean(
    process.env.SOCIALCRAWL_API_KEY || process.env.YOUTUBE_API_KEY,
  );
}

export interface RunResult {
  run: RunLog;
  signals: ScoredSignal[];
}

export async function runPipeline(
  runningWith: {
    force?: boolean;
    /**
     * Reels that were ALREADY paid for by the caller (e.g. a niche search).
     * Passing them in skips harvesting entirely, so a niche search costs only
     * the search itself instead of re-pulling every account it just found.
     */
    seedReels?: RawReel[];
    seedQuestions?: string[];
    /** a profile assembled for this run instead of the stored one */
    profile?: Profile;
    /** how many credits the caller already spent buying seedReels */
    seedCredits?: { spent: number; calls: number };
    /** whose plan/ideas this belongs to; defaults to the drive-wide store */
    db?: Store;
  } = {},
): Promise<RunResult> {
  const db = runningWith.db ?? store;
  const started = Date.now();
  const steps: RunLog["steps"] = [];
  const errors: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const t0 = Date.now();
    const result = await fn();
    steps.push({ name, detail: "", ms: Date.now() - t0 });
    return result;
  };

  const profile = runningWith.profile ?? (await db.getProfile()) ?? defaultProfile();
  await db.saveProfile(profile);
  const live = liveMode();

  let reels;
  let sounds: Record<string, SoundStats>;
  let harvestedQuestions: string[] = [];
  let spend: RunLog["credits"] = {
    spent: 0,
    calls: 0,
    remaining: null,
    cached: false,
  };

  if (runningWith.seedReels?.length) {
    /**
     * The caller already bought these reels (niche search). Re-pulling the
     * accounts they came from would spend the credits a second time, so the
     * harvest stage is skipped outright.
     */
    reels = runningWith.seedReels;
    sounds = deriveSoundStats(reels);
    harvestedQuestions = runningWith.seedQuestions ?? [];
    const bal = await checkBalance();
    spend = {
      spent: runningWith.seedCredits?.spent ?? 0,
      calls: runningWith.seedCredits?.calls ?? 0,
      remaining: bal.balance,
      cached: false,
    };
    steps.push({
      name: "spend",
      detail: `${spend.spent} credits on ${spend.calls} calls (paid by the niche search), ${
        bal.balance ?? "?"
      } left`,
      ms: 0,
    });
  } else if (live) {
    resetCreditLedger();
    const harvested = await harvestAll(profile, { force: runningWith.force });
    reels = harvested.reels;
    harvestedQuestions = harvested.questions;
    errors.push(...harvested.errors);
    sounds = deriveSoundStats(reels);
    const c = harvested.credits;
    spend = {
      spent: c.spent,
      calls: c.calls,
      remaining: c.remaining,
      cached: Boolean(harvested.cached),
    };
    steps.push({
      name: "spend",
      detail: harvested.cached
        ? `0 credits — reused cached pull from ${new Date(harvested.fetchedAt ?? "").toLocaleString()}`
        : `${c.spent} credits on ${c.calls} calls, ${c.remaining ?? "?"} left`,
      ms: 0,
    });
  } else {
    reels = demoReels();
    sounds = demoSoundStats();
    harvestedQuestions = [
      "Is n8n worth learning in 2026 or should I just use Make?",
      "How do you price an automation retainer?",
      "Why does my AI agent keep looping on the same step?",
      "Do clients actually care about which tool you use?",
      "How long before an automation pays for itself?",
    ];
  }
  steps.push({
    name: "harvest",
    detail: `${reels.length} reels from ${new Set(reels.map((r) => r.account)).size} accounts`,
    ms: 0,
  });

  const scored = await step("score", () => scoreSignals(reels, sounds));
  const cleared = filterSignals(scored);
  /**
   * A keyword search for a niche returns accounts that tagged themselves into
   * it. Keeping them because the maths works is how a packing-machine reel ends
   * up as advice for someone posting AI agent demos.
   */
  const qualifying = keepRelevant(cleared, nicheVocab(profile));
  steps[steps.length - 1].detail = `${cleared.length} outliers cleared the gate, ${qualifying.length} in this space`;

  // Validate demand beyond one account: cluster outliers by theme, then count
  // how many INDEPENDENT accounts the theme shows up on.
  // clustering gets the full qualifying set, not just the ones decoded into cards:
  // evidence of shared demand is stronger with more accounts in the pool
  const clusters = await step("converge", () => converge(qualifying));
  const converged = clusters.filter((c) => c.support >= 2).length;
  steps[steps.length - 1].detail = `${clusters.length} themes, ${converged} backed by 2+ accounts`;

  /**
   * Which outliers earn a pattern card. Ranking purely by outlier ratio buries
   * the best evidence: a single account's 130x outranks a theme that three
   * unrelated accounts hit, which is exactly backwards. So convergence lifts a
   * signal into the decode set instead of only adjusting its final score.
   */
  const confidenceBySignal = new Map<string, number>();
  for (const c of clusters) {
    for (const id of c.signalIds) {
      confidenceBySignal.set(id, Math.max(confidenceBySignal.get(id) ?? 0, c.confidence));
    }
  }
  const byScore = [...qualifying].sort(
    (a, b) =>
      b.signalScore + 45 * (confidenceBySignal.get(b.id) ?? 0) -
      (a.signalScore + 45 * (confidenceBySignal.get(a.id) ?? 0)),
  );

  /**
   * A 250x reel captioned "Try this for free 😍✅......" is real demand but it
   * cannot ground an idea: there is nothing in it to borrow. Such signals stay
   * in the evidence pool (they prove the theme travels) but are not decoded
   * into pattern cards, which is why topics used to fall back to a hashtag.
   */
  const decodable = byScore.filter((s) => topicPhrase(s.caption).length >= 4);
  // Two per account at most: one account having a great week is how a feed of
  // ten ideas ends up being one creator's month.
  const top = capPerAccount(
    (decodable.length >= 6 ? decodable : byScore).slice(0, 24),
    2,
  ).slice(0, 14);
  steps[steps.length - 1].detail += `, ${top.length} decoded (convergence-boosted, ${
    decodable.length >= 6 ? "caption-grounded" : "fallback: thin captions"
  })`;

  const patterns = await step("decode", () => decompose(top));
  steps[steps.length - 1].detail = `${patterns.length} pattern cards`;

  const enriched: Profile = {
    ...profile,
    commentQuestions: [
      ...new Set([...(profile.commentQuestions ?? []), ...harvestedQuestions]),
    ].slice(0, 40),
  };
  await db.saveProfile(enriched);

  const drafts = await step("adapt", () => adapt(enriched, patterns));
  steps[steps.length - 1].detail = `${drafts.length} candidates`;

  const history = await db.getIdeas();
  const ideas = await step("rank", () =>
    rank(drafts, scored, enriched, history, 10, clusters),
  );
  steps[steps.length - 1].detail = `${ideas.length} ideas kept after dedupe`;

  const archived = history.filter((i) => i.status !== "new");
  await db.saveIdeas([...ideas, ...archived].slice(0, 60));
  await db.saveSignals(scored.slice(0, 60).filter((s) => s.ratio >= 1.5));
  await db.savePatterns(patterns);
  await db.saveClusters(clusters);

  const run: RunLog = {
    id: `run_${started.toString(36)}`,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    mode: live ? "live" : "demo",
    steps,
    counts: {
      signals: top.length,
      patterns: patterns.length,
      ideas: ideas.length,
      converged,
    },
    credits: spend,
    errors,
  };
  const runs = await db.getRuns();
  await db.saveRuns([...runs, run]);

  return { run, signals: scored };
}
