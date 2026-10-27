/**
 * Hunt for holes in the language gate across every pull we already hold.
 *
 * The scored eval (`eval-language.ts`) proves the gate on a labelled sample.
 * This does the opposite: it goes looking for the mistakes a test written by
 * the same person who wrote the gate would never think to check for.
 *
 * Two failures matter, and they are not symmetric:
 *
 *   leak        a reel in another language survived into the room — its views
 *               join the median, its song joins the recommendations. This is
 *               what the owner saw: Telugu and Turkish reels in an English pull.
 *   false drop  a real reel in the room was thrown out — the page loses good
 *               evidence and the creator is shown a smaller world than exists.
 *
 * A leak is found by asking "was this kept on nothing, while something in its
 * own text pointed elsewhere?" A false drop is found by asking "was this thrown
 * out while nothing in its own text placed it elsewhere?" — both read the same
 * evidence the gate reads, so a hit is a genuine disagreement inside the file,
 * not a second opinion from outside it.
 *
 *   npx tsx scripts/audit-language.ts            # every cached pull
 *   npx tsx scripts/audit-language.ts <slug>     # one, with full examples
 */
import { promises as fs } from "node:fs";
import { readLanguage, roomLanguage, accountProfile, inLanguage, commentsLanguage, explicitLanguage, isSuspect } from "../lib/lang";
import { romanisedLanguage } from "../lib/lexicon";
import type { RawReel } from "../lib/types";

/** Verdicts that rest on the caption, or on nothing at all. */
const WEAK = new Set(["unknown", "english-caption-unknown", "ok:english", "ok:provider", "ok:place"]);

const short = (s: string, n = 78) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

async function main() {
  const only = process.argv[2];
  const names = (await fs.readdir("data/niches")).filter((f) => f.endsWith(".json")).sort();

  let leaks = 0;
  let falseDrops = 0;
  let suspects = 0;
  let totalIn = 0;
  let totalKept = 0;

  for (const name of names) {
    const slug = name.replace(/\.json$/, "");
    if (only && slug !== only) continue;
    const held = JSON.parse(await fs.readFile(`data/niches/${name}`, "utf8"));
    const payload: RawReel[] = held.payload ?? [];
    if (!payload.length) continue;
    const query: string = held.query ?? slug;

    const room = roomLanguage(query, { pull: payload });
    const want = room.code;

    const byAccount = new Map<string, RawReel[]>();
    for (const r of payload) {
      const list = byAccount.get(r.account) ?? [];
      list.push(r);
      byAccount.set(r.account, list);
    }
    const profiles = new Map<string, ReturnType<typeof accountProfile> | null>();
    for (const [h, list] of byAccount) {
      const p = accountProfile(list, want);
      profiles.set(h, p.mixed ? null : p);
    }

    const kept: RawReel[] = [];
    let suspectCount = 0;
    const dropped: { r: RawReel; why: string }[] = [];
    for (const r of payload) {
      const v = inLanguage(r, want, profiles.get(r.account) ?? null);
      /**
       * Suspect counts as dropped, as it does in `shape()` — it is a reel the
       * account contradicts that no witness could rescue. Tracked apart so the
       * report can show how much of the pruning rests on an account rather than
       * on the reel itself.
       */
      if (v.keep && !isSuspect(v.why)) kept.push(r);
      else {
        if (isSuspect(v.why)) suspectCount += 1;
        dropped.push({ r, why: v.why });
      }
    }

    /** Kept on nothing, while its own text hinted somewhere else. */
    const leakRisk = kept.filter((r) => {
      const v = inLanguage(r, want, profiles.get(r.account) ?? null);
      if (!WEAK.has(v.why) && !isSuspect(v.why)) return false;
      const hint =
        romanisedLanguage(r.audioName ?? "") ??
        romanisedLanguage(r.caption ?? "") ??
        commentsLanguage(r.comments, r.topComments);
      return Boolean(hint && hint.code !== want);
    });
    /** Dropped while nothing in its own text placed it elsewhere. */
    const dropRisk = dropped.filter(({ r, why }) => {
      const said = readLanguage(r);
      // A drop is only suspicious when the evidence for it is the weakest kind:
      // one tag, or an account with one label — never a script, the audio or a
      // comment section that plainly speaks another language.
      if (!/^(tag|account|place|comments):/.test(why)) return false;
      const own = explicitLanguage(r);
      const aud = romanisedLanguage(r.audioName ?? "");
      return !own && !aud;
    });

    suspects += suspectCount;
    totalIn += payload.length;
    totalKept += kept.length;
    leaks += leakRisk.length;
    falseDrops += dropRisk.length;

    const reasons = new Map<string, number>();
    for (const d of dropped) reasons.set(d.why, (reasons.get(d.why) ?? 0) + 1);
    const reasonLine = [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([w, n]) => `${w} ${n}`)
      .join(" · ");

    console.log(
      `\n=== ${slot(query)}  →  ${want ?? "no constraint"} [${room.basis}]` +
        `\n    ${payload.length} in · ${kept.length} kept · ${dropped.length} dropped` +
        (reasonLine ? `\n    ${reasonLine}` : "") +
        `\n    leak-risk ${leakRisk.length} · false-drop-risk ${dropRisk.length}` +
        (suspectCount ? ` · ${suspectCount} suspect (dropped unless a witness speaks)` : ""),
    );

    for (const r of leakRisk.slice(0, only ? 20 : 3)) {
      const hint =
        romanisedLanguage(r.audioName ?? "") ??
        romanisedLanguage(r.caption ?? "") ??
        commentsLanguage(r.comments, r.topComments);
      console.log(
        `      LEAK @${r.account} ${fmt(r.views)} [${hint?.code ?? "?"}] ${short(r.caption ?? "")}` +
          (r.audioName ? `  ⟨${short(r.audioName, 40)}⟩` : ""),
      );
    }
    for (const { r, why } of dropRisk.slice(0, only ? 20 : 3)) {
      console.log(`      DROP @${r.account} ${fmt(r.views)} [${why}] ${short(r.caption ?? "")}`);
    }
  }

  console.log(
    `\n=== ${totalIn} reels · ${totalKept} kept (${((totalKept / Math.max(1, totalIn)) * 100).toFixed(0)}%)` +
      ` · ${leaks} leak-risk · ${falseDrops} false-drop-risk · ${suspects} suspect`,
  );
}

const slot = (s: string) => (s.length > 34 ? `${s.slice(0, 33)}…` : s).padEnd(34);
const fmt = (n: number | undefined) =>
  n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
