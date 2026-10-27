/**
 * Sweep every cached pull for leaks the gate should have caught.
 *
 * The eval scores one labelled sample. This asks the same question of every
 * room we hold: is there a reel sitting in this room whose own text says it
 * belongs somewhere else? It is deliberately adversarial — it re-reads the
 * evidence *after* the gate has finished, so anything it finds is a real
 * disagreement, not a second opinion.
 *
 *   npx tsx scripts/audit-corpus.ts
 *
 * Costs nothing: reads data/niches.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { accountProfile, inLanguage, isSuspect, languageName, readLanguage, roomLanguage } from "../lib/lang";
import { romanisedLanguage } from "../lib/lexicon";
import type { RawReel } from "../lib/types";

const dir = path.join(process.cwd(), "data", "niches");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

let rooms = 0;
let keptTotal = 0;
let leaks = 0;
let weak = 0;
let constrained = 0;
let constrainedKept = 0;
let constrainedSoft = 0;

for (const f of files) {
  const d = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const payload = (d.payload ?? []) as RawReel[];
  const query = String(d.query ?? f.replace(/\.json$/, "").replace(/-/g, " "));
  if (!payload.length) continue;
  rooms += 1;

  const room = roomLanguage(query, { own: [], pull: payload });
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

  const flagged: string[] = [];
  let kept = 0;
  let soft = 0;
  for (const r of payload) {
    const v = inLanguage(r, want, accountLang.get(r.account) ?? null);
    if (!v.keep || isSuspect(v.why)) continue;
    kept += 1;
    keptTotal += 1;

    // Was this kept on nothing stronger than "the caption looked English"?
    const said = readLanguage(r);
    const attested = want
      ? !/^(unknown|english-caption-unknown|ok:english|ok:provider)$/.test(v.why)
      : Boolean((said.code && said.from !== "words" && said.from !== "place") || r.topComments?.length);
    if (!attested) soft += 1;

    // Would the post's own text have placed it elsewhere?
    //
    // Only asked of reels that carry no explicit language evidence of their
    // own: a Kannada cover of a Hindi song is tagged #KannadaCoverSong, and the
    // song title alone would otherwise convict it of being Hindi. Explicit
    // evidence wins, which is exactly the order the gate uses.
    if (want) {
      /**
       * `english` is not a citation: a caption written in English is the
       * absence of evidence, not proof of the room. `words` and `place` are
       * hints from the lexicon, too weak to convict on their own.
       */
      const decisive = said.code && said.code !== "en" && said.from !== "english" && said.from !== "words" && said.from !== "place";
      if (decisive && said.code !== want) {
        flagged.push(`LEAK ${said.from}:${said.code} @${r.account} "${(r.caption ?? "").slice(0, 44)}"`);
        continue;
      }
      if (!decisive) {
        const rom = romanisedLanguage(r.caption ?? "");
        if (rom && rom.code !== want && rom.strong > 0) {
          flagged.push(`LEAK romanised:${rom.code} @${r.account} "${(r.caption ?? "").slice(0, 44)}"`);
        }
      }
    }
  }
  weak += soft;
  if (want) {
    constrained += 1;
    constrainedKept += kept;
    constrainedSoft += soft;
  }
  leaks += flagged.length;
  if (flagged.length) {
    console.log(`\n=== ${query}  →  ${languageName(want)} [${room.basis}]  kept ${kept}, soft ${soft}`);
    for (const line of flagged.slice(0, 8)) console.log(`  ${line}`);
    if (flagged.length > 8) console.log(`  … ${flagged.length - 8} more`);
  }
}

console.log(
  `\n=== ${rooms} rooms · ${keptTotal} kept reels · ${leaks} leaks · ${weak} kept on a caption alone`,
);
console.log(
  `=== ${constrained} of those rooms name a language: ${constrainedKept} kept, ` +
    `${constrainedSoft} on a caption alone (${constrainedKept ? ((constrainedSoft / constrainedKept) * 100).toFixed(0) : 0}%)`,
);
console.log(leaks === 0 ? "PASS: no kept reel contradicts its own room" : `FAIL: ${leaks} leaks`);
