/**
 * Does the interest taxonomy cover what real people type?
 *
 * The recommendation flow is: free text -> matchInterests -> candidatesFor.
 * If matchInterests returns nothing, the route 400s with "Pick at least one
 * thing you know" and a brand-new creator is stuck. So the failure that matters
 * is not a bad ranking, it is an empty list.
 *
 * Run: npx tsx scripts/check-coverage.ts
 */
import { INTERESTS, candidatesFor, matchInterests } from "../lib/nicheSeeds";

/** Things a real creator would type, including spaces the taxonomy calls "art". */
const PHRASES = [
  // craft / hands-on
  "pottery", "knitting", "crochet", "woodworking", "calligraphy", "sewing",
  "jewellery making", "vintage watch restoration", "leather craft",
  // professional niches
  "dentistry", "physiotherapy", "nursing student", "lawyer", "accountant",
  "architect", "teacher", "veterinary", "pharmacy", "engineering student",
  "recruitment", "insurance", "logistics", "supply chain",
  // food/regional
  "biryani", "baking sourdough", "coffee brewing", "cocktails", "vegan nutrition",
  "south indian cooking", "street food india",
  // niche sport / hobby
  "calisthenics", "powerlifting", "marathon training", "cricket coaching",
  "skateboarding", "climbing", "surfing", "badminton",
  // money/tech deep
  "crypto trading", "day trading", "excel tutorials", "cybersecurity",
  "data science", "prompt engineering", "no code tools", "web development",
  // beauty/fashion deep
  "skincare routine", "hair styling", "nail art", "menswear", "thrift fashion",
  "makeup for beginners",
  // life / identity
  "new mum", "homeschooling", "student life", "night shift nurse",
  "moving abroad", "minimalism", "sobriety", "mental health",
  // auto / property
  "car detailing", "motorcycle touring", "home renovation", "interior design",
  "real estate investing",
  // pets / nature
  "dog training", "cat behaviour", "aquascaping", "gardening", "beekeeping",
  // culture
  "anime", "book reviews", "history facts", "language learning", "chess",
  "true crime", "standup comedy", "film analysis",
];

/** Also test the way people actually type: a sentence, not a keyword. */
const SENTENCES = [
  "I'm a dentist who loves pottery on weekends",
  "I restore vintage watches in my garage",
  "I want to start posting but I only know nursing",
  "I cook biryani like my grandmother",
  "I am a chartered accountant, boring job, want a side thing",
  "Just had a baby and want to document it",
  "I play badminton competitively",
  "I collect vinyl records",
];

/**
 * What each phrase *should* resolve to.
 *
 * The old check only asked whether the list was empty, so it printed a tick
 * beside `dog training -> home workout` and `cat behaviour -> dog training`.
 * A recommendation that lands in the wrong room is worse than no recommendation:
 * the creator spends a search on it, gets a plan about a different hobby, and
 * concludes the engine does not understand them. So the assertions live here.
 *
 * `null` means "no group is a good fit — the LLM path should decide", which is a
 * legitimate outcome and not a failure.
 */
const EXPECT: Record<string, string[] | null> = {
  pottery: ["diy", "art"],
  knitting: ["diy"],
  crochet: ["diy"],
  woodworking: ["diy"],
  calligraphy: ["art", "diy"],
  sewing: ["diy"],
  "jewellery making": ["diy", "fashion"],
  "vintage watch restoration": ["diy", "auto"],
  "leather craft": ["diy"],
  dentistry: ["health", "work"],
  physiotherapy: ["health"],
  "nursing student": ["health", "education", "work"],
  lawyer: ["work"],
  accountant: ["work", "money"],
  architect: ["art", "home", "work"],
  teacher: ["education", "work"],
  veterinary: ["pets", "health"],
  pharmacy: ["health"],
  "engineering student": ["education", "tech"],
  recruitment: ["work", "business"],
  insurance: ["money", "business"],
  logistics: ["business", "work"],
  "supply chain": ["business", "work"],
  biryani: ["food"],
  "baking sourdough": ["food"],
  "coffee brewing": ["food"],
  cocktails: ["food"],
  "vegan nutrition": ["food", "health"],
  "south indian cooking": ["food"],
  "street food india": ["food"],
  calisthenics: ["fitness", "sports"],
  powerlifting: ["fitness", "sports"],
  "marathon training": ["sports", "fitness"],
  "cricket coaching": ["sports"],
  skateboarding: ["sports"],
  climbing: ["sports"],
  surfing: ["sports"],
  badminton: ["sports"],
  "crypto trading": ["money"],
  "day trading": ["money"],
  "excel tutorials": ["tech", "education"],
  cybersecurity: ["tech"],
  "data science": ["tech"],
  "prompt engineering": ["tech"],
  "no code tools": ["tech"],
  "web development": ["tech"],
  "skincare routine": ["beauty"],
  "hair styling": ["beauty"],
  "nail art": ["beauty"],
  menswear: ["fashion"],
  "thrift fashion": ["fashion"],
  "makeup for beginners": ["beauty"],
  "new mum": ["parenting"],
  homeschooling: ["education", "parenting"],
  "student life": ["education"],
  "night shift nurse": ["work", "health"],
  "moving abroad": ["travel"],
  minimalism: ["home", "mindset"],
  sobriety: ["mindset", "health"],
  "mental health": ["health", "mindset"],
  "car detailing": ["auto"],
  "motorcycle touring": ["auto", "travel"],
  "home renovation": ["home"],
  "interior design": ["home"],
  "real estate investing": ["realestate", "money"],
  "dog training": ["pets"],
  "cat behaviour": ["pets"],
  aquascaping: ["nature", "pets"],
  gardening: ["nature", "home"],
  beekeeping: ["nature"],
  anime: ["culture", "comedy"],
  "book reviews": ["culture", "education"],
  "history facts": ["culture", "education"],
  "language learning": ["education", "culture"],
  chess: ["culture", "sports"],
  "true crime": ["culture"],
  "standup comedy": ["comedy"],
  "film analysis": ["culture", "photography"],
};

const rows: { phrase: string; ids: string[]; first: string | null }[] = [];

for (const p of [...PHRASES, ...SENTENCES]) {
  const ids = matchInterests(p);
  /** Mirrors the route: the creator's own words order the rooms. */
  const cands = candidatesFor(ids, 1, p);
  rows.push({ phrase: p, ids, first: cands[0]?.query ?? null });
}

const missed = rows.filter((r) => r.ids.length === 0);

console.log(`\nTaxonomy groups: ${INTERESTS.length}`);
console.log(`Tested: ${rows.length} phrases`);
console.log(`Matched: ${rows.length - missed.length}`);
console.log(`MISSED: ${missed.length}  (${Math.round((missed.length / rows.length) * 100)}%)\n`);

console.log("--- MISSED (route would 400 with 'pick something you know') ---");
for (const m of missed) console.log(`  ✗ ${m.phrase}`);

console.log("\n--- matched, but is the candidate room right? ---");
const wrong: string[] = [];
for (const r of rows.filter((r) => r.ids.length)) {
  const want = EXPECT[r.phrase];
  const ok = want ? r.ids.some((id) => want.includes(id)) : true;
  if (want && !ok) wrong.push(r.phrase);
  console.log(
    `  ${want ? (ok ? "✓" : "✗") : "·"} ${r.phrase.padEnd(34)} -> ${r.ids.join(",").padEnd(18)} -> "${r.first}"`,
  );
}

if (wrong.length) {
  console.log(`\n--- WRONG ROOM (${wrong.length}) — right space exists, ranking preferred another ---`);
  for (const w of wrong) console.log(`  ✗ ${w}`);
}

const failed = missed.length + wrong.length;
console.log(
  `\n=== ${rows.length} phrases · missed ${missed.length} · wrong room ${wrong.length} ===`,
);
if (failed) {
  console.log("FAIL");
  process.exit(1);
}
console.log("PASS");

