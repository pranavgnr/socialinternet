import { promises as fs } from "node:fs";
import path from "node:path";
// Type-only, so this never becomes a runtime cycle between the store and the
// module that builds the plan being stored.
import type { RoomPlan } from "./newcomer";
import type { WeeklyDigest } from "./weekly";
import type {
  ConvergenceCluster,
  GrowthPlan,
  Idea,
  PatternCard,
  Profile,
  RunLog,
  ScoredSignal,
} from "./types";

const ROOT = process.env.CREATORS_DATA_DIR
  ? path.resolve(process.env.CREATORS_DATA_DIR)
  : path.join(process.cwd(), "data");

export interface Store {
  getProfile: () => Promise<Profile | null>;
  saveProfile: (p: Profile) => Promise<void>;
  getSignals: () => Promise<ScoredSignal[]>;
  saveSignals: (s: ScoredSignal[]) => Promise<void>;
  getPatterns: () => Promise<PatternCard[]>;
  savePatterns: (p: PatternCard[]) => Promise<void>;
  getClusters: () => Promise<ConvergenceCluster[]>;
  saveClusters: (c: ConvergenceCluster[]) => Promise<void>;
  getIdeas: () => Promise<Idea[]>;
  saveIdeas: (i: Idea[]) => Promise<void>;
  getRuns: () => Promise<RunLog[]>;
  saveRuns: (r: RunLog[]) => Promise<void>;
  getPlan: () => Promise<GrowthPlan | null>;
  savePlan: (p: GrowthPlan) => Promise<void>;
  /**
   * The plan for someone with no account yet, built from a room rather than a
   * feed. Kept apart from `plan.json` because it answers a different question
   * and must not be mistaken for a plan about the visitor's own handle.
   */
  getRoom: () => Promise<RoomPlan | null>;
  saveRoom: (p: RoomPlan) => Promise<void>;
  /** this week's digest is the last one written; history is newest-first */
  getWeekly: () => Promise<WeeklyDigest[]>;
  saveWeekly: (w: WeeklyDigest[]) => Promise<void>;
  updateIdea: (id: string, patch: Partial<Idea>) => Promise<Idea | null>;
}

/**
 * Every account gets its own directory. Nothing is shared between two people
 * using the site, so one handle can never overwrite another's plan.
 */
export function createStore(dir: string): Store {
  async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async function writeJson(file: string, value: unknown) {
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, file);
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(tmp, target);
  }

  return {
    getProfile: () => readJson<Profile | null>("profile.json", null),
    saveProfile: (p) => writeJson("profile.json", p),

    getSignals: () => readJson<ScoredSignal[]>("signals.json", []),
    saveSignals: (s) => writeJson("signals.json", s),

    getPatterns: () => readJson<PatternCard[]>("patterns.json", []),
    savePatterns: (p) => writeJson("patterns.json", p),

    getClusters: () => readJson<ConvergenceCluster[]>("clusters.json", []),
    saveClusters: (c) => writeJson("clusters.json", c),

    getIdeas: () => readJson<Idea[]>("ideas.json", []),
    saveIdeas: (i) => writeJson("ideas.json", i),

    getRuns: () => readJson<RunLog[]>("runs.json", []),
    saveRuns: (r) => writeJson("runs.json", r.slice(-20)),

    getPlan: () => readJson<GrowthPlan | null>("plan.json", null),
    savePlan: (p) => writeJson("plan.json", p),

    getRoom: () => readJson<RoomPlan | null>("room.json", null),
    saveRoom: (p) => writeJson("room.json", p),

    getWeekly: () => readJson<WeeklyDigest[]>("weekly.json", []),
    /** a year of Mondays is plenty; the page only ever shows the last few */
    saveWeekly: (w) => writeJson("weekly.json", w.slice(0, 52)),

    async updateIdea(id, patch) {
      const ideas = await readJson<Idea[]>("ideas.json", []);
      const idx = ideas.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      ideas[idx] = { ...ideas[idx], ...patch };
      await writeJson("ideas.json", ideas);
      return ideas[idx];
    },
  };
}

/** The drive-wide store: shared niche research, plus the pre-launch account. */
export const store = createStore(ROOT);

/** Where one visitor's own plan, ideas and run history live. */
export function accountDir(id: string): string {
  return path.join(ROOT, "accounts", id);
}
