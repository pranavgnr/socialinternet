/**
 * Does the intent resolver actually fix the dead ends?
 *
 * Uses the same corpus as scripts/check-coverage.ts, plus the sentences that
 * fired the *wrong* taxonomy group ("I'm a dentist who loves pottery" used to
 * match food because of the word "loves").
 *
 * Run: npx tsx --env-file=.env.local scripts/check-intent.ts
 */
import { resolveIntent, usableRoom } from "../lib/nicheIntent";

const CASES = [
  // the 63 that dead-ended, sampled across the space
  "pottery", "knitting", "woodworking", "jewellery making",
  "vintage watch restoration", "dentistry", "physiotherapy", "lawyer",
  "nursing student", "architecture student", "supply chain", "biryani",
  "coffee brewing", "cocktails", "powerlifting", "badminton",
  "crypto trading", "excel tutorials", "cybersecurity", "prompt engineering",
  "menswear", "new mum", "homeschooling", "sobriety",
  "aquascaping", "beekeeping", "anime", "chess", "true crime", "film analysis",
  // the wrong-match sentences
  "I'm a dentist who loves pottery on weekends",
  "I restore vintage watches in my garage",
  "I want to start posting but I only know nursing",
  "I cook biryani like my grandmother",
  "I am a chartered accountant, boring job, want a side thing",
  "Just had a baby and want to document it",
  "I collect vinyl records",
  // the ones the taxonomy already handled — must not regress
  "home workout",
  "I like cooking",
];

(async () => {
  let dead = 0;
  let bad = 0;

  for (const c of CASES) {
    const r = await resolveIntent(c);
    const rooms = r.rooms.map((x) => x.query);
    const invalid = rooms.filter((q) => !usableRoom(q));
    if (!rooms.length) dead++;
    bad += invalid.length;

    console.log(`\n"${c}"`);
    console.log(`  via=${r.via}  words=${r.words.slice(0, 5).join(",")}`);
    console.log(`  rooms:    ${rooms.join(" | ") || "(none)"}`);
    console.log(`  adjacent: ${r.adjacent.map((a) => a.query).join(" | ") || "(none)"}`);
    if (invalid.length) console.log(`  !! unusable phrases: ${invalid.join(", ")}`);
  }

  console.log(
    `\n=== ${CASES.length} cases · dead ends: ${dead} · unusable phrases: ${bad} ===`,
  );
})();
