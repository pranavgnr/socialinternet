/**
 * The subject gate: does the room get filtered, or does the gate stand down?
 *
 * Two ways this gate can be wrong, and they cost differently.
 *
 *   · Never applying. A pull is dominated by a few accounts we enriched; if the
 *     gate wants three anchored accounts and the pull only enriched two, a
 *     correct room is declared unreadable and every fit check, birthday
 *     transition and meme is handed back. The median is then computed over
 *     posts that were never about the subject — which is the thing the gate
 *     exists to prevent, arrived at by inaction.
 *
 *   · Applying to a wrong room. A standing-down gate is the only thing between
 *     a mis-search and a page of confident nonsense, so it has to stand down
 *     when the accounts genuinely say something else.
 *
 * Every case here is one of those two, with the numbers that decide it.
 *
 *   npx tsx scripts/check-subject.ts     # exits non-zero on any failure
 */
import { keepOnSubject } from "../lib/subject";

interface P {
  account: string;
  caption: string;
  hashtags?: string[];
}

const post = (account: string, caption: string, hashtags: string[] = []): P => ({
  account,
  caption,
  hashtags,
});

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail: string) => {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}  ${detail}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label}  ${detail}`);
  }
};

console.log("=== A room with only two enriched accounts must still filter");

{
  /**
   * The real shape of a covers pull: a search returns many one-reel sightings
   * and two accounts we topped up. Those two are the only ones that can say
   * anything about the subject, and both do.
   */
  const posts: P[] = [
    post("covergirl", "little ukelele cover #cover", ["cover", "songcover"]),
    post("covergirl", "so easy to fall in love cover", ["cover"]),
    post("covergirl", "you're gonna live forever in me cover", ["cover"]),
    post("covergirl", "birthday transition :)", ["fyp"]),
    post("covergirl", "lil fit check", ["fyp", "outfit"]),
    post("singerguy", "creep acoustic cover", ["cover", "acoustic"]),
    post("singerguy", "wildflower cover", ["cover"]),
    post("singerguy", "my hair is getting so long", ["fyp"]),
    post("oneshot1", "a cover of blinding lights", ["cover"]),
    post("oneshot2", "new cover out now", ["cover"]),
    post("oneshot3", "cover of the night", ["cover"]),
  ];
  const r = keepOnSubject(posts, "english music covers", { minKept: 8 });
  const dropped = r.dropped.map((d) => d.reel.caption);
  check(
    r.applied,
    "applied",
    `applied=${r.applied} kept=${r.kept.length}/${posts.length}`,
  );
  /**
   * Three of the eleven are beside the point — a fit check, a birthday
   * transition and a hair update — and all three come from accounts that are
   * genuinely cover artists. That is the case this gate exists for: the account
   * is right and the reel is not.
   */
  check(
    dropped.length === 3 && dropped.every((c) => /fit check|birthday|so long/.test(c)),
    "dropped only the off-subject reels",
    dropped.length ? dropped.join(" | ") : "nothing dropped",
  );
  check(
    r.kept.every((p) => !/fit check/.test(p.caption)),
    "the fit check is out of the room",
    `${r.kept.length} kept`,
  );
}

console.log("\n=== A pull where the enriched accounts are all off-subject must stand down");

{
  /**
   * A finance search answered by a cooking pull. Nobody in the pull has two
   * finance reels, because it is not a finance room — the honest answer is
   * "cannot read this", and the page says so instead of printing a median.
   */
  const posts: P[] = [
    post("chef1", "hyderabadi biryani in 30 minutes", ["biryani", "recipe"]),
    post("chef1", "chicken kebab on the grill", ["kebab", "recipe"]),
    post("chef1", "meal prep for the week", ["mealprep"]),
    post("chef2", "paneer butter masala", ["recipe", "paneer"]),
    post("chef2", "quick dal tadka", ["recipe", "dal"]),
    post("chef3", "sourdough starter day 3", ["sourdough"]),
    post("chef3", "sourdough loaf crumb shot", ["sourdough"]),
    post("chef4", "street food in mumbai", ["streetfood"]),
    post("chef4", "pav bhaji at home", ["recipe"]),
  ];
  const r = keepOnSubject(posts, "personal finance for young adults", { minKept: 8 });
  check(!r.applied, "stood down", `applied=${r.applied}`);
  check(
    r.kept.length === posts.length,
    "handed the pull back whole",
    `${r.kept.length}/${posts.length}`,
  );
}

console.log("\n=== One prolific account alone is not enough");

{
  /**
   * The share rule. Four accounts have several reels and only one talks about
   * the subject: that one account is a habit, not the room.
   */
  const posts: P[] = [
    post("covers", "cover of driver's license", ["cover"]),
    post("covers", "cover of vampire", ["cover"]),
    post("covers", "another cover for you", ["cover"]),
    post("vlogger1", "day in my life", ["vlog"]),
    post("vlogger1", "morning routine", ["vlog"]),
    post("vlogger2", "grwm for school", ["grwm"]),
    post("vlogger2", "night routine", ["vlog"]),
    post("vlogger3", "storytime", ["storytime"]),
    post("vlogger3", "q and a", ["storytime"]),
    post("vlogger4", "haul", ["haul"]),
    post("vlogger4", "unboxing", ["haul"]),
  ];
  const r = keepOnSubject(posts, "english music covers", { minKept: 8 });
  check(!r.applied, "stood down", `applied=${r.applied} · ${r.reason}`);
}

console.log("\n=== Silence is never evidence against a reel");

{
  const posts: P[] = [
    post("a1", "cover of the night", ["cover"]),
    post("a1", "another cover", ["cover"]),
    post("a2", "cover of stay", ["cover"]),
    post("a2", "cover of ghost", ["cover"]),
    post("a3", "🎵", []),
    post("a3", "🎶🎶", ["shorts"]),
    post("a4", "cover", ["cover"]),
    post("a5", "cover of perfect", ["cover"]),
    post("a6", "cover of yellow", ["cover"]),
  ];
  const r = keepOnSubject(posts, "english music covers", { minKept: 8 });
  /**
   * A caption with no readable word at all is the case: emoji are one code
   * point each in a string length but say nothing, so the test counts letters
   * rather than characters.
   */
  const silent = r.kept.filter((p) => !/[a-z]/i.test(p.caption));
  check(
    silent.length === 2,
    "emoji-only captions survive",
    `${silent.length} kept of 2`,
  );
}

console.log("\n=== A phrase that names no subject is not filtered");

{
  const posts: P[] = [
    post("x1", "anything at all here", ["fyp"]),
    post("x2", "another thing", ["fyp"]),
  ];
  const r = keepOnSubject(posts, "in", { minKept: 8 });
  check(!r.applied, "no subject → no filter", r.reason ?? "no reason given");
}

console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
process.exit(fail ? 1 : 0);
