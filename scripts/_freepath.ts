/**
 * Does the pipeline still work when the paid balance is zero?
 *
 * Runs the real pipeline against an isolated store with a profile nothing has
 * ever been cached for, then prints what a creator would actually receive.
 */
import { readFileSync } from "node:fs";

import { runPipeline } from "../lib/pipeline";
import { createStore } from "../lib/store";
import type { Profile } from "../lib/types";

/** Next loads .env.local for the app; a bare tsx run does not. */
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // no .env.local: fine, this probe is also useful in demo mode
}

const niche = process.argv[2] ?? "sourdough baking";
const dir = `/tmp/freepath-${Date.now()}`;

const profile: Profile = {
  niche,
  audience: "home bakers who want to stop wasting flour",
  offer: "beginner-friendly sourdough guides",
  pillars: ["beginner mistakes", "starter care", "timing and temperature", "gear"],
  voice: "patient, practical, no mystique",
  bannedWords: ["game-changer", "unlock"],
  constraints: { solo: true, maxSeconds: 45, setting: "kitchen counter" },
  benchmarks: [],
  keywords: [`${niche} beginner`, `${niche} mistakes`],
  ownWinners: [],
  commentQuestions: [],
};

async function main() {
  const t0 = Date.now();
  const { run, signals } = await runPipeline({
    force: true,
    profile,
    db: createStore(dir),
  });

  console.log(`niche: ${niche}`);
  console.log(`mode: ${run.mode} | ${Date.now() - t0}ms | signals ${signals.length}`);
  console.log("counts:", JSON.stringify(run.counts));
  console.log("steps:");
  for (const s of run.steps) console.log(`  - ${s.name}: ${s.detail} (${s.ms}ms)`);
  console.log("errors:");
  for (const e of run.errors) console.log(`  ! ${e}`);
  console.log("platforms:", JSON.stringify(
    [...signals.reduce((m, s) => m.set(s.platform, (m.get(s.platform) ?? 0) + 1), new Map<string, number>())],
  ));

  const ideas = await createStore(dir).getIdeas();
  console.log(`\nideas: ${ideas.length}`);
  for (const i of ideas.slice(0, 4)) {
    console.log(`  * ${i.title ?? "(untitled)"}`);
    if (i.hookVariants?.[0]) console.log(`    hook: ${i.hookVariants[0]}`);
    if (i.whyThis) console.log(`    why: ${i.whyThis}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
