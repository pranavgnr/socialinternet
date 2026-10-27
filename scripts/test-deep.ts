/**
 * End-to-end check of the deep pass: one real reel, one credit.
 *
 *   npx tsx --env-file=.env.local scripts/test-deep.ts <handle> [limit]
 *
 * Buys the post (comments + MP4), watches the video locally for free, then shows
 * the hook verdict and the comment mining exactly as the plan would build them.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { mineComments } from "../lib/comments";
import { enrich } from "../lib/enrich";
import { hookVerdict } from "../lib/audit";
import { buildAudit } from "../lib/audit";
import { mediaTools } from "../lib/media";
import type { RawReel } from "../lib/types";

async function main() {
  const want = process.argv[2];
  const limit = Number(process.argv[3] ?? 2);
  const dir = path.join(process.cwd(), "data", "handles");

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let reels: RawReel[] = [];
  let handle = "";
  for (const f of files) {
    const d = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    if (want && !f.includes(want) && !String(d.handle).includes(want)) continue;
    if (!reels.length || f.includes(want ?? "")) {
      reels = d.reels ?? [];
      handle = d.handle;
      if (want) break;
    }
  }
  if (!reels.length) throw new Error(`no reels for ${want ?? "any handle"}`);

  // newest, best-performing first: the reels the deep pass actually picks
  const sorted = [...reels].sort((a, b) => b.views - a.views).slice(0, limit);
  console.log(`handle: ${handle} · ${reels.length} reels · buying ${sorted.length}`);
  console.log("tools:", mediaTools());

  const { reels: enriched, report } = await enrich(sorted, {
    maxCredits: limit,
    watch: limit,
  });
  console.log("report:", JSON.stringify(report, null, 2));

  for (const r of enriched) {
    console.log("\n---", r.url);
    console.log("caption:", (r.caption ?? "").slice(0, 90));
    console.log("views:", r.views, "comments:", (r.topComments ?? []).length);
    if (r.hook) {
      console.log("hook mode:", r.hook.mode);
      console.log("spoken:", (r.hook.spoken ?? "").slice(0, 160));
      console.log("on screen:", (r.hook.onScreen ?? []).join(" | ").slice(0, 160));
      console.log("speech start:", r.hook.speechStartMs, "ms · text at start:", r.hook.textAtStart);
      if (r.hook.note) console.log("note:", r.hook.note);
    } else {
      console.log("hook: none");
    }
    const sample = (r.topComments ?? []).slice(0, 3).map((c) => c.text);
    if (sample.length) console.log("comments:", sample);
  }

  const verdict = hookVerdict(enriched);
  console.log("\nhook verdict:", JSON.stringify(verdict, null, 2));

  const mining = mineComments(enriched.map((r) => ({ url: r.url, comments: r.topComments })));
  console.log("\ncomment mining:", JSON.stringify(mining, null, 2).slice(0, 1200));

  const audit = buildAudit({ reels: enriched });
  console.log("\naudit:", JSON.stringify(audit, null, 2).slice(0, 900));
  void mineComments;
}

void main();
