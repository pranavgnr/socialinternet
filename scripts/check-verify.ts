/**
 * Does the two-witness pass actually settle what the caption cannot?
 *
 * The language gate is scored in `eval-language.ts`; this scores the step after
 * it — the one that watches the video and then reads the comments under the
 * reels the text could not decide. It is the only paid step in the pipeline, so
 * it is proven with an injected buyer: every case runs offline, spends nothing,
 * and asserts what was kept, what was dropped, what was bought and what was
 * left unconfirmed.
 *
 *   npx tsx scripts/check-verify.ts
 *
 * Exits non-zero when a case fails, so it can gate a release.
 */
import { inLanguage } from "../lib/lang";
import { watchToVerify } from "../lib/verifyLang";
import type { RawReel } from "../lib/types";

let pass = 0;
let fail = 0;

function reel(over: Partial<RawReel> & { id: string }): RawReel {
  return {
    platform: "instagram",
    account: over.account ?? `acct_${over.id}`,
    url: over.url ?? `https://www.instagram.com/reel/${over.id}/`,
    caption: over.caption ?? "",
    postedAt: "2026-09-01T00:00:00Z",
    views: over.views ?? 10_000,
    likes: 100,
    comments: over.comments ?? 10,
    ...over,
  } as RawReel;
}

function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name} — ${detail}`);
  }
}

/** The buyer, faked: it records what was asked for and returns fixed comments. */
function buyerReturning(table: Record<string, string[]>, opts: { throwOn?: string } = {}) {
  const calls: string[] = [];
  const buyPost = async (url: string) => {
    calls.push(url);
    if (opts.throwOn && url.includes(opts.throwOn)) throw new Error("402 insufficient credits");
    const id = url.split("/reel/")[1]?.replace("/", "") ?? url;
    return { topComments: (table[id] ?? []).map((text) => ({ text })) };
  };
  return { buyPost, calls };
}

const HINDI = ["kya baat hai bhai", "bahut pyara gaana hai", "mast gana hai yaar", "dil se suna"];
const TELUGU = ["super ga undhi akka", "chala bagundi ra", "ee song keka", "nidhra poru emo"];
const ENGLISH = ["love this cover", "your voice is amazing", "what song is this", "obsessed"];

async function main() {
  console.log("\n=== English room: an English caption with Hindi comments under it");
  {
    const r = reel({ id: "AA1", caption: "love this one 💛", account: "cover_acct" });
    const { buyPost, calls } = buyerReturning({ AA1: HINDI });
    const out = await watchToVerify([r], "en", { buyPost, max: 0 });
    check(
      "dropped on the comments",
      out.dropped.length === 1 && out.dropped[0].why === "comments:hi",
      JSON.stringify(out.dropped.map((d) => d.why)),
    );
    check("kept nothing", out.kept.length === 0, `${out.kept.length} kept`);
    check("bought exactly one post", calls.length === 1, `${calls.length} buys`);
    check("one credit counted", out.stats.credits === 1, `${out.stats.credits}`);
    check(
      "the comments were kept on the reel, so a rebuild never pays again",
      (r.topComments?.length ?? 0) === HINDI.length,
      `${r.topComments?.length ?? 0} comments stored`,
    );
  }

  console.log("\n=== English room: an English caption, English audience");
  {
    const r = reel({ id: "AA2", caption: "somewhere only we know", account: "cover_acct" });
    const { buyPost, calls } = buyerReturning({ AA2: ENGLISH });
    const out = await watchToVerify([r], "en", { buyPost, max: 0 });
    check("kept", out.kept.length === 1, JSON.stringify(out.dropped.map((d) => d.why)));
    check("counted as confirmed", (out.stats.commentsConfirmed ?? 0) === 1, `${out.stats.commentsConfirmed}`);
    check("still only one buy", calls.length === 1, `${calls.length}`);
  }

  console.log("\n=== English room: nobody said anything");
  {
    const r = reel({ id: "AA3", caption: "lil fit check", account: "cover_acct" });
    const { buyPost } = buyerReturning({ AA3: ["🔥", "❤️", "🙌"] });
    const out = await watchToVerify([r], "en", { buyPost, max: 0 });
    check("kept — silence is not evidence", out.kept.length === 1, JSON.stringify(out.dropped.map((d) => d.why)));
    check("reported as leftover", out.stats.leftover === 1, `${out.stats.leftover}`);
  }

  console.log("\n=== A failed buy costs nothing and decides nothing");
  {
    const r = reel({ id: "AA4", caption: "somewhere only we know", account: "cover_acct" });
    const { buyPost } = buyerReturning({}, { throwOn: "AA4" });
    const out = await watchToVerify([r], "en", { buyPost, max: 0 });
    check("kept", out.kept.length === 1, JSON.stringify(out.dropped.map((d) => d.why)));
    check("no credit charged for a failed call", out.stats.credits === 0, `${out.stats.credits}`);
    check("no reel dropped", out.stats.dropped === 0, `${out.stats.dropped}`);
  }

  console.log("\n=== The credit ceiling holds");
  {
    const reels = ["BB1", "BB2", "BB3", "BB4"].map((id, i) =>
      reel({ id, caption: "somewhere only we know", views: 50_000 - i * 1_000 }),
    );
    const { buyPost, calls } = buyerReturning({ BB1: ENGLISH, BB2: ENGLISH, BB3: ENGLISH, BB4: ENGLISH });
    const out = await watchToVerify(reels, "en", { buyPost, max: 0, maxBought: 2, creditBudget: 2 });
    check("bought two of four", calls.length === 2, `${calls.length} buys`);
    check("spent two credits", out.stats.credits === 2, `${out.stats.credits}`);
    check("kept all four", out.kept.length === 4, `${out.kept.length}`);
    check(
      "the biggest reels were the ones bought",
      calls.every((u) => u.includes("BB1") || u.includes("BB2")),
      calls.join(","),
    );
  }

  console.log("\n=== A comment list already in hand is not bought again");
  {
    const r = reel({
      id: "CC1",
      caption: "love this one 💛",
      topComments: TELUGU.map((text) => ({ text, likes: 0 })),
    });
    const { buyPost, calls } = buyerReturning({ CC1: ENGLISH });
    const out = await watchToVerify([r], "en", { buyPost, max: 0 });
    check("zero buys", calls.length === 0, `${calls.length}`);
    check("not even a candidate — the held comments already answer it", out.stats.candidates === 0, `${out.stats.candidates}`);
    check(
      "the gate convicts it on those comments",
      inLanguage(r, "en").why === "comments:te",
      inLanguage(r, "en").why,
    );
  }

  console.log("\n=== A reel the text already condemned is never paid for");
  {
    // A romanised Hindi title is explicit evidence, so the gate drops it before
    // this pass starts — buying its comments would be money spent on an answer.
    const r = reel({ id: "CC2", caption: "barbaad - saiyaara", account: "cover_acct" });
    const { buyPost, calls } = buyerReturning({ CC2: HINDI });
    const out = await watchToVerify([r], "en", { buyPost, max: 0 });
    check("zero buys", calls.length === 0, `${calls.length}`);
    check("left for the gate, not dropped here", out.dropped.length === 0, `${out.dropped.length}`);
    check("not counted as a candidate", out.stats.candidates === 0, `${out.stats.candidates}`);
  }

  console.log("\n=== A Telugu room keeps its Telugu reels");
  {
    const r = reel({ id: "DD1", caption: "nidhra poru emo", account: "telugu_acct" });
    const { buyPost } = buyerReturning({ DD1: TELUGU });
    const out = await watchToVerify([r], "te", { buyPost, max: 0 });
    check("kept", out.kept.length === 1, JSON.stringify(out.dropped.map((d) => d.why)));
  }

  console.log("\n=== No language in the room means no pass");
  {
    const r = reel({ id: "EE1", caption: "barbaad - saiyaara" });
    const { buyPost, calls } = buyerReturning({ EE1: HINDI });
    const out = await watchToVerify([r], null, { buyPost, max: 0 });
    check("nothing bought", calls.length === 0, `${calls.length}`);
    check("nothing dropped", out.dropped.length === 0, `${out.dropped.length}`);
    check("said why it did nothing", Boolean(out.stats.skipped), `${out.stats.skipped}`);
  }

  console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} checks passed${fail ? `, ${fail} failed` : ""}`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
