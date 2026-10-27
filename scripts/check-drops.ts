/**
 * Every reel the language gate threw out, with the text it read.
 *
 * A gate is only as good as its false positives: a drop that was really an
 * English cover is a customer's evidence disappearing. So each dropped reel is
 * printed with the caption, tags and audio title that convicted it, next to the
 * verdict, and the list is paged so it can be read rather than skimmed.
 *
 *   npx tsx scripts/check-drops.ts english-music-covers [--kept] [--limit 40]
 *
 * `--kept` prints the opposite side: reels that survived, so both halves of the
 * gate can be checked against what is actually on Instagram.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { accountProfile, languageName, readLanguage, roomLanguage } from "../lib/lang";
import { inLanguage } from "../lib/lang";
import type { AccountLangProfile } from "../lib/lang";
import type { RawReel } from "../lib/types";

const args = process.argv.slice(2);
const slug =
  args.find((a) => !a.startsWith("--")) ?? "english-music-covers";
const showKept = args.includes("--kept");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) || 40 : 40;

const file = path.join(process.cwd(), "data", "niches", `${slug}.json`);
if (!existsSync(file)) {
  console.error(`no cached pull at ${file}`);
  process.exit(1);
}
const stored = JSON.parse(readFileSync(file, "utf8")) as {
  query?: string;
  payload?: RawReel[];
};
const query = stored.query ?? slug.replace(/-/g, " ");
const payload = stored.payload ?? [];

const byAccount = new Map<string, RawReel[]>();
for (const r of payload) {
  const list = byAccount.get(r.account) ?? [];
  list.push(r);
  byAccount.set(r.account, list);
}
const room = roomLanguage(query, { pull: payload });
const profiles = new Map<string, AccountLangProfile | null>();
for (const [handle, list] of byAccount) {
  const p = accountProfile(list, room.code);
  profiles.set(handle, p.mixed ? null : p);
}

const rows = payload
  .map((r) => ({
    reel: r,
    verdict: inLanguage(r, room.code, profiles.get(r.account) ?? null),
    read: readLanguage(r),
  }))
  .filter((x) => (showKept ? x.verdict.keep : !x.verdict.keep))
  .sort((a, b) => (b.reel.views ?? 0) - (a.reel.views ?? 0));

console.log(
  `${query}  →  room ${languageName(room.code)} (${room.basis}) · ` +
    `${showKept ? "kept" : "dropped"} ${rows.length} of ${payload.length}`,
);

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

for (const { reel, verdict, read } of rows.slice(0, limit)) {
  console.log(
    `\n@${reel.account}  ${Math.round((reel.views ?? 0) / 1000)}k  ${verdict.why}  ` +
      `[${read.code ?? "?"}/${read.from ?? "-"}]`,
  );
  console.log(`  cap: ${clip(reel.caption ?? "", 160) || "—"}`);
  const tags = (reel.hashtags ?? []).slice(0, 8).join(" ");
  if (tags) console.log(`  tags: ${clip(tags, 120)}`);
  if (reel.audioName) console.log(`  audio: ${clip(reel.audioName, 90)}`);
  if (reel.onScreenText) console.log(`  screen: ${clip(reel.onScreenText, 120)}`);
  if (reel.spoken) console.log(`  spoken: ${clip(reel.spoken, 120)}`);
}
