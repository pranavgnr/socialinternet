/**
 * One live search, then the gate, then the video — the accuracy measurement.
 *
 * The offline checks prove the rules; this proves the room. It costs exactly
 * one credit (the search, and the provider caches it), because the video is
 * read locally for nothing. It answers the question the complaint was really
 * about: of the reels we KEPT for a language, how many are actually in it?
 *
 *   npx tsx --env-file=.env.local scripts/probe-live-gate.ts "english music covers" 10
 *
 * The second argument is how many weakly-kept reels to watch. A reel kept on
 * its caption is a guess; watching it is the only way to score that guess, and
 * it is free.
 *
 * The pull is saved to data/_probe_live.json so later probes reuse it at no
 * cost — a measurement that cannot be repeated is not a measurement.
 */
import { writeFileSync } from "node:fs";

import {
  accountProfile,
  inLanguage,
  languageName,
  readLanguage,
  roomLanguage,
} from "../lib/lang";
import { creditLedger, searchReelsWithMeta } from "../lib/harvest";
import { mediaReady, readHook } from "../lib/media";
import type { RawReel } from "../lib/types";

const query = process.argv[2] ?? "english music covers";
const watchMax = Number(process.argv[3] ?? 10);

const WEAK = new Set(["unknown", "english-caption-unknown", "ok:english", "ok:provider"]);

function gate(reels: RawReel[], want: string | null) {
  const byAccount = new Map<string, RawReel[]>();
  for (const r of reels) {
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }
  const profiles = new Map<string, ReturnType<typeof accountProfile>>();
  for (const [handle, list] of byAccount) profiles.set(handle, accountProfile(list, want));
  const kept: { reel: RawReel; why: string }[] = [];
  const dropped: { reel: RawReel; why: string }[] = [];
  for (const r of reels) {
    const p = profiles.get(r.account);
    const v = inLanguage(r, want, p?.mixed ? null : p);
    (v.keep ? kept : dropped).push({ reel: r, why: v.why });
  }
  return { kept, dropped };
}

function summarise(label: string, kept: { why: string }[], dropped: { why: string }[]) {
  const weak = kept.filter((k) => WEAK.has(k.why)).length;
  const by: Record<string, number> = {};
  for (const d of dropped) by[d.why] = (by[d.why] ?? 0) + 1;
  console.log(
    `   ${label}: kept ${kept.length} (${kept.length - weak} on evidence, ${weak} on a caption)` +
      ` · dropped ${dropped.length} ${JSON.stringify(by)}`,
  );
}

async function main() {
  const { data, reels } = await searchReelsWithMeta(query);
  const ledger = creditLedger();
  writeFileSync("data/_probe_live.json", JSON.stringify({ query, reels }, null, 1));

  console.log(`\n=== "${query}" → ${reels.length} reels, ${ledger.spent} credit(s) spent`);
  const rel = (data.relevance ?? {}) as Record<string, unknown>;
  console.log(
    `   provider: total ${String(data.total ?? "—")} · dropped ${String(data.dropped ?? 0)}` +
      ` · relevance kept ${String(rel.kept ?? "—")}/${String(rel.rows ?? "—")}`,
  );
  const langs: Record<string, number> = {};
  for (const r of reels) if (r.language) langs[r.language] = (langs[r.language] ?? 0) + 1;
  console.log(
    `   provider language on ${reels.filter((r) => r.language).length}/${reels.length} rows ${JSON.stringify(langs)}` +
      ` · media URL on ${reels.filter((r) => r.mediaUrl).length}/${reels.length}`,
  );

  const room = roomLanguage(query, { pull: reels });
  const want = room.code;
  console.log(`   room: ${languageName(want)} [${room.basis}${room.word ? ` "${room.word}"` : ""}]`);

  const before = gate(reels, want);
  summarise("before watching", before.kept, before.dropped);

  const weak = before.kept
    .filter((k) => WEAK.has(k.why))
    .sort((a, b) => (b.reel.views ?? 0) - (a.reel.views ?? 0));
  if (!weak.length) {
    console.log("\n   nothing rests on a caption — no video to check");
    return;
  }
  console.log(`\n=== watching ${Math.min(watchMax, weak.length)} of ${weak.length} caption-only keeps`);
  if (!mediaReady()) console.log("   (no local transcriber — the video cannot be read)");

  const changed: string[] = [];
  const watched: string[] = [];
  for (const k of weak.slice(0, watchMax)) {
    const r = k.reel;
    const reading = await readHook({ reel: r, mediaUrl: r.mediaUrl });
    const onScreen = reading.onScreen?.join(" · ").slice(0, 200) ?? "";
    const spoken = reading.spoken?.slice(0, 200) ?? "";
    if (onScreen) r.onScreenText = onScreen;
    if (spoken) r.spoken = spoken;
    if (reading.heardLang) {
      r.heardLang = reading.heardLang;
      r.heardLangProb = reading.heardLangProb;
    }
    const fromVideo = readLanguage({
      onScreenText: onScreen,
      spoken,
      heardLang: reading.heardLang,
      heardLangProb: reading.heardLangProb,
    });
    watched.push(
      `   @${r.account} heard ${reading.heardLang ?? "—"}${
        reading.heardLangProb !== undefined ? ` p=${reading.heardLangProb.toFixed(2)}` : ""
      } · video ${fromVideo.code ?? "—"}/${fromVideo.from ?? "—"}` +
        `\n      cap  "${(r.caption ?? "").replace(/\s+/g, " ").slice(0, 64)}"` +
        (spoken ? `\n      said "${spoken.replace(/\s+/g, " ").slice(0, 70)}"` : "") +
        (onScreen ? `\n      read "${onScreen.replace(/\s+/g, " ").slice(0, 70)}"` : ""),
    );
  }
  for (const line of watched) console.log(line);

  const after = gate(reels, want);
  console.log("");
  summarise("after watching", after.kept, after.dropped);
  const keptIds = new Set(after.kept.map((k) => k.reel.id));
  const confirmed = after.kept.filter(
    (k) => watched.some((w) => w.includes(`@${k.reel.account}`)) && k.why.startsWith("ok:"),
  );
  for (const w of weak.slice(0, watchMax)) {
    if (!keptIds.has(w.reel.id)) changed.push(`removed @${w.reel.account}`);
  }
  console.log(
    `   the video settled ${confirmed.length} of the ${Math.min(watchMax, weak.length)} watched` +
      (changed.length ? ` · ${changed.join(", ")}` : " · nothing removed"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
