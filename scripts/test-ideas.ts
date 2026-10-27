/**
 * Replay a cached niche through the full idea pipeline with the model switched
 * on, and show what came out beside the reel it was learned from — so a ripoff
 * is visible at a glance instead of hidden behind a score.
 *
 *   npx tsx --env-file=.env.local scripts/test-ideas.ts [niche-slug]
 *
 * Costs zero SocialCrawl credits. Costs a few thousand DeepSeek tokens.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { adapt } from "../lib/adapt";
import { converge } from "../lib/converge";
import { deriveSoundStats } from "../lib/harvest";
import { researchFromCache } from "../lib/niche";
import { decompose, topicPhrase } from "../lib/patterns";
import { rank } from "../lib/rank";
import { capPerAccount, keepRelevant, nicheVocab } from "../lib/relevance";
import { filterSignals, scoreSignals } from "../lib/score";
import { profileFromNiche } from "../lib/niche";
import type { RawReel } from "../lib/types";

async function main() {
  const slug = process.argv[2] ?? "comedy-funny-dance-telugu";
  const file = path.join(process.cwd(), "data", "niches", `${slug}.json`);
  const stored = JSON.parse(await fs.readFile(file, "utf8")) as {
    payload: RawReel[];
    fetchedAt: string;
  };
  const query = slug.replace(/-/g, " ");

  const research = researchFromCache(query, stored.payload, {
    fetchedAt: stored.fetchedAt,
  });
  const profile = profileFromNiche(research, null);
  console.log(`niche: "${profile.niche}"`);
  console.log(`pillars: ${profile.pillars.slice(0, 5).join(" | ")}`);

  const scored = scoreSignals(stored.payload, deriveSoundStats(stored.payload));
  const qualifying = keepRelevant(filterSignals(scored), nicheVocab(profile));

  const clusters = await converge(qualifying);
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
  const decodable = byScore.filter((s) => topicPhrase(s.caption).length >= 4);
  const top = capPerAccount(
    (decodable.length >= 6 ? decodable : byScore).slice(0, 24),
    2,
  ).slice(0, 14);

  console.log(
    `signals: ${scored.length} scored, ${qualifying.length} relevant, ${top.length} decoded\n`,
  );

  const patterns = await decompose(top);
  console.log(`pattern cards: ${patterns.length}`);
  for (const p of patterns.slice(0, 6)) {
    console.log(`  [${p.format}] topic="${p.topic}" hook="${p.hookText.slice(0, 70)}…"`);
  }

  const drafts = await adapt(profile, patterns);
  console.log(`\ncandidates: ${drafts.length}`);

  const ideas = rank(drafts, scored, profile, [], 10, clusters);
  console.log(`kept after copy gate + dedupe: ${ideas.length}\n`);

  const captionById = new Map(top.map((s) => [s.id, s] as const));
  for (const [i, idea] of ideas.entries()) {
    const src = captionById.get(idea.receipt.signalId);
    console.log("─".repeat(78));
    console.log(`${i + 1}. ${idea.title}`);
    console.log(`   hook:      ${idea.hookVariants[0]}`);
    console.log(`   topic:     ${idea.topic}  [${idea.format} / ${idea.hookType}]`);
    console.log(`   why:       ${idea.whyThis}`);
    console.log(`   novelty:   ${idea.scoreParts.novelty}  fit: ${idea.scoreParts.fit}`);
    console.log(`   SOURCE @${src?.account ?? "?"}: ${(src?.caption ?? "").replace(/\s+/g, " ").slice(0, 150)}`);
  }

  await fs.writeFile(
    path.join("data", `_ideas_${slug}.json`),
    JSON.stringify(ideas, null, 2),
  );
  console.log(`\nwrote data/_ideas_${slug}.json`);
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
