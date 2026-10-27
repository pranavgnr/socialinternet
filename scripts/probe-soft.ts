/**
 * Print every kept reel in a room that rests on the caption alone.
 *
 * `audit-corpus` counts them; this lists them, with the evidence the gate had,
 * so the failures can be read rather than guessed at.
 *
 *   npx tsx scripts/probe-soft.ts english-music-covers
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { accountProfile, inLanguage, isSuspect, readLanguage, roomLanguage } from "../lib/lang";
import type { RawReel } from "../lib/types";

const name = process.argv[2] ?? "english-music-covers";
const d = JSON.parse(readFileSync(path.join(process.cwd(), "data", "niches", `${name}.json`), "utf8"));
const payload = (d.payload ?? []) as RawReel[];
const room = roomLanguage(String(d.query ?? name.replace(/-/g, " ")), { own: [], pull: payload });
const want = room.code;

const byAccount = new Map<string, RawReel[]>();
for (const r of payload) {
  const list = byAccount.get(r.account) ?? [];
  list.push(r);
  byAccount.set(r.account, list);
}
const accountLang = new Map(
  [...byAccount].map(([h, list]) => {
    const p = accountProfile(list, want);
    return [h, p.mixed ? null : p] as const;
  }),
);

let soft = 0;
let kept = 0;
for (const r of payload) {
  const v = inLanguage(r, want, accountLang.get(r.account) ?? null);
  if (!v.keep || isSuspect(v.why)) continue;
  kept += 1;
  const softVerdict = /^(unknown|english-caption-unknown|ok:english|ok:provider)$/.test(v.why);
  if (!softVerdict) continue;
  soft += 1;
  const said = readLanguage(r);
  console.log(
    `\n${v.why}  @${r.account}  ${r.views}v  lang=${r.language ?? "-"}  said=${said.code ?? "-"}/${said.from}`,
  );
  console.log(`  cap: ${(r.caption ?? "").replace(/\n/g, " ").slice(0, 110)}`);
  if (r.audioName) console.log(`  audio: ${r.audioName.slice(0, 90)}`);
  if (r.hashtags?.length) console.log(`  tags: ${r.hashtags.slice(0, 8).join(" ").slice(0, 110)}`);
  if (r.topComments?.length)
    console.log(`  comments: ${r.topComments.slice(0, 3).map((c) => (c.text ?? "").slice(0, 40)).join(" | ")}`);
}

console.log(`\n=== ${name}: room ${room.code} [${room.basis}] · kept ${kept} · caption-only ${soft}`);
