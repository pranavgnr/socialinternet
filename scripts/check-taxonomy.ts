/**
 * The taxonomy fast path, checked for wrong matches.
 *
 * The failure this guards against is a *confident* wrong answer, which is worse
 * than a dead end: "home workout" returning "home decor" looks like a working
 * feature and quietly tells a gym creator to post about interiors.
 *
 * Run: npx tsx --env-file=.env.local scripts/check-taxonomy.ts
 */
import { resolveIntent } from "../lib/nicheIntent";

const CASES = [
  "home workout",
  "gym",
  "I like cooking",
  "quick recipes",
  "personal finance",
  "dog training",
  "fitness and cooking",
  "street food",
  "skincare",
  "travel",
  "comedy",
  "photography",
  "real estate",
  "car",
  "music",
  "dance",
];

/** Groups whose rooms should never appear for a given input. */
const FORBIDDEN: Record<string, string[]> = {
  "home workout": ["decor", "apartment"],
  gym: ["decor", "apartment", "recipe"],
  "I like cooking": ["workout", "decor"],
  "personal finance": ["workout", "decor"],
};

(async () => {
  let wrong = 0;
  for (const c of CASES) {
    const r = await resolveIntent(c);
    const all = [...r.rooms.map((x) => x.query), ...r.adjacent.map((x) => x.query)];
    const bad = (FORBIDDEN[c] ?? []).filter((f) =>
      all.some((q) => q.toLowerCase().includes(f)),
    );
    if (bad.length) wrong++;
    console.log(
      `\n"${c}"  via=${r.via}  groups=${r.interests.join(",") || "-"}`,
    );
    console.log(`  rooms:    ${r.rooms.map((x) => x.query).join(" | ")}`);
    console.log(`  adjacent: ${r.adjacent.map((x) => x.query).join(" | ") || "(none)"}`);
    if (bad.length) console.log(`  !! WRONG: contains ${bad.join(", ")}`);
  }
  console.log(`\n=== ${CASES.length} cases · wrong-group answers: ${wrong} ===`);
})();
