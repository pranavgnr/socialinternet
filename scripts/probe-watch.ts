/**
 * What does watching one reel actually return?
 *
 *   npx tsx scripts/probe-watch.ts <reel-url-or-index>
 *
 * Prints the hook reading (mode, spoken text, on-screen text, note) for a reel
 * already in data/_verify_probe.json, so a "confirmed" verdict can be checked
 * against what was really read instead of assumed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { readHook } from "../lib/media";
import type { RawReel } from "../lib/types";

const PROBE = path.join(process.cwd(), "data", "_verify_probe.json");

async function main() {
  const arg = process.argv[2] ?? "0";
  const { payload } = JSON.parse(readFileSync(PROBE, "utf8")) as { payload: RawReel[] };
  const picks = /^\d+$/.test(arg)
    ? payload.slice(Number(arg), Number(arg) + 1)
    : payload.filter((r) => r.account === arg.replace(/^@/, ""));

  for (const reel of picks) {
    console.log(`\n@${reel.account} ${reel.url}`);
    console.log(`  provider: ${reel.language ?? "-"} · views ${reel.views}`);
    console.log(`  media: ${reel.mediaUrl ? "yes" : "none"}`);
    const reading = await readHook({ reel, mediaUrl: reel.mediaUrl });
    console.log(`  mode: ${reading.mode} · basis: ${reading.basis}`);
    console.log(`  spoken: ${JSON.stringify((reading.spoken ?? "").slice(0, 120))}`);
    console.log(`  onScreen: ${JSON.stringify(reading.onScreen ?? [])}`);
    console.log(`  note: ${reading.note ?? "-"}`);
  }
}

main();
