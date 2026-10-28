import type { ArchetypeGuess } from "./archetype";
import { times } from "./fmt";
import { detectFormat, rankFormats, shapesTheyUse, videoFormat, type FormatPick } from "./formats";
import { hookShapeId, hookShapeLabel, rankHooks, type HookPick } from "./hooks";
import type { NicheAccount } from "./niche";
import { ownSongWinners, rankSongs, songOf, type SongPick } from "./songs";
import {
  clusterThemes,
  durationBucket,
  evidenceFrom,
  fmt,
  groupRows,
  median,
  sentenceCase,
  titleCase,
  type Row,
} from "./stats";
import type { PlanEvidence, PlanMove, RawReel } from "./types";

/**
 * What to tell this kind of account, in the order it should be told.
 *
 * Every move is assembled from the same raw material — reels that beat their own
 * account's usual views — but the moves themselves are chosen by archetype,
 * because the levers are different. A singer's next reel is decided by which
 * song she picks; a teacher's is decided by the first line. Giving both the same
 * five suggestions is what made the old plan read like a template.
 *
 * A move with no receipts is dropped here, not softened later.
 */

export interface PlayCtx {
  handle: string;
  archetype: ArchetypeGuess;
  /** reels from OTHER accounts, each measured against its own usual views */
  rows: Row[];
  own: RawReel[];
  ownMedian: number;
  ownBest: number;
  /** the typical post in this space, used when one post is all we hold */
  nicheMedian?: number;
  peers: NicheAccount[];
  ownGapDays: number | null;
  peerGapDays: number | null;
  /**
   * Whether the cohort is actually made of accounts the creator's own size.
   *
   * The moves below say "accounts your size" in almost every sentence, and
   * when the cohort could not be size-matched that phrase is a claim about
   * evidence that does not exist. @natgeotravel (44.5M followers) was told the
   * strongest post "among 2 accounts your size" did 2.8x — the two accounts
   * were the whole of a fallback room, one of them @nasa, and the plan's own
   * basis line said in the same breath that it could not call them a cohort.
   */
  sizeMatched: boolean;
}

const SERIES = /\b(cover|day|ep|episode|part|song)\s*\[?\s*\d+\s*[/\-–]\s*\d+/i;

/**
 * Spread the first pick across a cohort.
 *
 * Every account in a niche sees the same rows, so `rankSongs` returns the same
 * order for all of them — and twenty creators in the same niche were all told to
 * cover the same song, based on one account's outlier. That is bad advice (they
 * then compete with each other on the same audio) and it reads as a template.
 *
 * When several songs are equally defensible the choice between them *is*
 * arbitrary, so it is made stable per handle instead of always "the first one":
 * same account, same answer on every refresh; different accounts, different
 * songs.
 */
const STOP = new Set(
  "your you the a an and or of to in on for is are be it this that more with make post posts next one not yet than then they their about at as by from up out do does did how what which who why".split(
    " ",
  ),
);

/**
 * The title is the instruction, so the comparison is made on titles only. Folding
 * the action text in made every set long enough that a genuine duplicate scored
 * just under the bar — the same move survived twice.
 */
const keyWords = (m: PlanMove): Set<string> =>
  new Set(
    m.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/**
 * Drop a move that says what an earlier move already said.
 *
 * "Make a day-in-the-life" and "post more day-in-the-life" came out of two
 * different detectors and were shown one after the other — two of four slots
 * spent on the same instruction, which makes the whole plan look padded. A move
 * survives only if it shares under half its significant words with a move
 * already kept.
 */
function dedupe(moves: PlanMove[]): PlanMove[] {
  const sets = moves.map(keyWords);

  /**
   * "accounts your size" and "broke out with it" sit in almost every title, so
   * they cannot be evidence that two moves say the same thing. A word appearing
   * in most of the candidate titles is scaffolding: ignored.
   */
  const df = new Map<string, number>();
  for (const s of sets) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);
  const common = new Set(
    [...df.entries()].filter(([, n]) => n > Math.max(1, moves.length / 2)).map(([w]) => w),
  );
  const sig = sets.map((s) => new Set([...s].filter((w) => !common.has(w))));

  const kept: PlanMove[] = [];
  const keptSig: Set<string>[] = [];
  for (let i = 0; i < moves.length; i++) {
    const words = sig[i];
    const clash = keptSig.some((other) => {
      if (!words.size || !other.size) return false;
      let shared = 0;
      for (const w of words) if (other.has(w)) shared++;
      // Two shared content words, and they have to be most of the shorter title.
      return shared >= 2 && shared / Math.min(words.size, other.size) >= 0.5;
    });
    if (!clash) {
      kept.push(moves[i]);
      keptSig.push(words);
    }
  }
  return kept;
}

/** `1` → "day", `2.4` → "2.4 days" — used for posting cadence. */
function every(days: number): string {
  const n = Math.round(days * 10) / 10;
  if (n <= 1) return "day";
  return `${Number.isInteger(n) ? n : n.toFixed(1)} days`;
}

function spread<T>(items: T[], handle: string): T[] {
  if (items.length < 2) return items;
  let h = 2166136261;
  for (let i = 0; i < handle.length; i++) {
    h ^= handle.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const offset = Math.abs(h) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

const evidenceFromSong = (s: SongPick, limit = 3): PlanEvidence[] =>
  s.evidence.slice(0, limit).map((e) => ({
    handle: `@${e.account}`,
    metric: `${
      e.accountBased
        ? `${e.ratio.toFixed(1)}x its usual views`
        : `${e.ratio.toFixed(1)}x the typical post here`
    } · ${fmt(e.views)} views`,
    url: e.url,
    caption: e.caption,
  }));

/* ------------------------------------------------------------------ *
 * Moves every kind of account can earn
 * ------------------------------------------------------------------ */

/** The topic move: only where a topic is the thing being chosen. */
function themeMove(ctx: PlayCtx): PlanMove | null {
  const themes = clusterThemes(ctx.rows);
  const top = themes[0];
  if (!top) return null;
  return {
    id: "theme",
    priority: 0,
    title: `Post more ${sentenceCase(top.label)} — ${top.accounts.length} accounts your size broke out with it`,
    why: `Across ${top.accounts.length} unrelated accounts, posts on this idea did ${top.medianRatio.toFixed(
      1,
    )} times their usual views. That is not one creator's audience — it is the topic pulling.`,
    action: `Make one post on ${top.label.toLowerCase()} this week, opening on the same promise, in your own format.`,
    evidence: top.rows.slice(0, 3).map(evidenceFrom),
  };
}

/** The opening-line move. Only for accounts where a spoken line is the hook. */
function hookMove(ctx: PlayCtx): PlanMove | null {
  const usable = ctx.rows.filter((r) => r.ratio >= 1.5);
  const groups = groupRows(
    usable,
    (r) => hookShapeId(r.reel.caption) ?? undefined,
  )
    // "statement" is the classifier's fallback, so "open with a flat statement"
    // is advice with no content. If nothing more specific qualifies, this move is
    // dropped and the plan leads with the topic or the shape instead.
    .filter((h) => h.rows.length >= 2 && h.key !== "statement");
  if (!groups.length) return null;

  /**
   * Which shape this creator already leans on. Every account in a niche sees the
   * same cohort rows, so the strongest bucket was the same answer for all
   * thirty-one of them — including the ones who already open that way. Being
   * told to do the thing you already do is worse than useless.
   */
  const ownCounts = new Map<string, number>();
  for (const r of ctx.own) {
    const id = hookShapeId(r.caption ?? "");
    if (id) ownCounts.set(id, (ownCounts.get(id) ?? 0) + 1);
  }
  const ownTotal = ctx.own.length || 1;

  const strength = (g: { rows: Row[] }) => median(g.rows.map((r) => r.ratio));
  const top = Math.max(...groups.map(strength));

  // Stay within striking distance of the best shape, then take the one this
  // account uses least. Variety never buys a weaker recommendation.
  const group = groups
    .filter((g) => strength(g) >= top * 0.8)
    .sort(
      (a, b) =>
        (ownCounts.get(a.key) ?? 0) / ownTotal - (ownCounts.get(b.key) ?? 0) / ownTotal ||
        strength(b) - strength(a),
    )[0];

  const best = group.rows[0];
  const used = ownCounts.get(group.key) ?? 0;
  const gap =
    used === 0
      ? "You do not open a single post this way."
      : `You open ${used} of your ${ctx.own.length} posts this way — the ones breaking out lean on it harder.`;

  return {
    id: "hook",
    priority: 0,
    title: `Open with ${hookShapeLabel(group.key)} — that is the shape behind the posts breaking out in your space`,
    why: `${group.rows.length} posts that beat their usual views open this way, the best at ${best.ratio.toFixed(
      1,
    )} times. ${gap}`,
    action: `Write three openers in this shape and keep the one that names a concrete outcome in the first five words.`,
    evidence: group.rows.slice(0, 3).map(evidenceFrom),
  };
}

/** Length, measured against the posts that actually broke out. */
function lengthMove(ctx: PlayCtx): PlanMove | null {
  const ownDurations = ctx.own
    .map((r) => r.durationSec)
    .filter((d): d is number => Boolean(d));
  const outlierRows = ctx.rows.filter((r) => r.ratio >= 1.5 && r.reel.durationSec);
  if (ownDurations.length < 3 || outlierRows.length < 3) return null;

  const ownDur = median(ownDurations);
  const outDur = median(outlierRows.map((r) => r.reel.durationSec as number));
  if (Math.abs(outDur - ownDur) < 8) return null;

  const longest = outlierRows.slice().sort((a, b) => b.ratio - a.ratio)[0];
  const music = ctx.archetype.songLed;

  return {
    id: "length",
    priority: 0,
    title: `Your posts run ${Math.round(ownDur)}s — the ones breaking out run ${Math.round(outDur)}s`,
    /**
     * The bucket used to be the whole sentence, so two posts that both landed in
     * "over 90s" produced "the ones breaking out run over 90s, yours run over
     * 90s" — true, and useless. The numbers are always stated; the bucket is
     * only added when it tells you something the numbers did not.
     */
    why: (() => {
      const sameBucket = durationBucket(outDur) === durationBucket(ownDur);
      const shape = sameBucket
        ? ""
        : ` The posts breaking out in your space run ${durationBucket(
            outDur,
          )}, yours run ${durationBucket(ownDur)}.`;
      return `Posts that beat their account's usual views run about ${Math.round(
        outDur,
      )}s; yours run about ${Math.round(
        ownDur,
      )}s.${shape} Same idea, different cut.`;
    })(),
    action: music
      ? `Cut your next ${Math.round(outDur)}s. For a song that usually means starting at the line people already know — skip the intro.`
      : `Cut the next three posts to about ${Math.round(outDur)}s. Trim the setup, not the payoff.`,
    evidence: [evidenceFrom(longest)],
  };
}

/** Cadence, only when the creator is genuinely slower than their band. */
function cadenceMove(ctx: PlayCtx): PlanMove | null {
  if (ctx.ownGapDays === null || ctx.peerGapDays === null) return null;
  if (ctx.ownGapDays <= ctx.peerGapDays * 1.6) return null;
  const bestPeer = ctx.peers.slice().sort((a, b) => b.medianViews - a.medianViews)[0];
  if (!bestPeer) return null;
  return {
    id: "cadence",
    priority: 0,
    title: `You post every ${every(ctx.ownGapDays)} — accounts your size post every ${every(ctx.peerGapDays)}`,
    why: `At your size, rhythm moves the account more than polish. @${
      bestPeer.handle
    } posts far more often and gets about ${fmt(bestPeer.medianViews)} views a post.`,
    action: `Bank three posts before Monday, then publish every ${every(
      Math.max(1, Math.round(ctx.peerGapDays)),
    )} for four weeks.`,
    evidence: [
      {
        handle: `@${bestPeer.handle}`,
        metric: `${fmt(bestPeer.medianViews)} views a post`,
        url: bestPeer.topReel.url,
        caption: bestPeer.topReel.caption,
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Video: the shape is the decision
 * ------------------------------------------------------------------ */

/** Words that mean a post leads with a finished result rather than the build-up. */
const RESULT_WORDS =
  /\b(before|after|result|finished|final|turned|transformation|glow ?up|progress|day \d+|done|ready)\b/i;

/**
 * The shape move — the answer to "what should I make more of?" for a creator
 * whose content is their own days. A song is not available to them and a spoken
 * hook is not the lever, so the recommendation is the shape of the video itself:
 * a day in the life, a routine, a list, a place, an attempt.
 */
function formatMove(ctx: PlayCtx, picks: FormatPick[]): PlanMove | null {
  const top = picks[0];
  if (!top) return null;
  const already = shapesTheyUse(ctx.own).find((s) => s.id === top.id);
  const best = top.rows[0];

  return {
    id: "format",
    priority: 0,
    title: already
      ? `Your "${top.label.toLowerCase()}" videos are the ones that travel — make another`
      : `Make a "${top.label.toLowerCase()}" — ${top.accounts} accounts your size broke out with one`,
    why: `${top.posts} posts in this shape beat their own account's usual views across ${top.accounts} different accounts, the best at ${best.ratio.toFixed(
      1,
    )} times. ${
      already
        ? `You already post this shape — ${already.count} of your recent posts are one. The gap is not the idea, it is how many you make.`
        : "You do not post this shape yet, which is why it is worth copying now rather than after it saturates."
    }`,
    action: `Make your next video in this shape: ${top.what}. Change the subject to your own, but keep the shape — the shape is what did the work.`,
    evidence: top.evidence,
  };
}

/**
 * The reveal move, for accounts where the visible result is the lever. Measured,
 * not asserted: it only ships when the posts breaking out genuinely lead with a
 * finished result.
 */
function payoffMove(ctx: PlayCtx): PlanMove | null {
  const breakouts = ctx.rows.filter((r) => r.ratio >= 1.5);
  if (breakouts.length < 4) return null;
  const resultFirst = breakouts.filter((r) => RESULT_WORDS.test(r.reel.caption));
  const share = Math.round((resultFirst.length / breakouts.length) * 100);
  if (share < 45) return null;
  const best = resultFirst.slice().sort((a, b) => b.ratio - a.ratio)[0] ?? breakouts[0];

  return {
    id: "payoff",
    priority: 0,
    title: `Show the finished result at 0:00 — ${share}% of the posts breaking out do`,
    why: `${resultFirst.length} of the ${breakouts.length} posts that beat their account's usual views in your space put the result up front. On a post like yours the viewer is deciding whether the payoff is worth the watch, and they decide that before you have explained anything.`,
    action:
      "Cut your next post so the finished thing is on screen in the first second, then rewind and show how it got there. The build-up is the second act, never the first.",
    evidence: [evidenceFrom(best)],
  };
}

/* ------------------------------------------------------------------ *
 * Music: the song is the decision
 * ------------------------------------------------------------------ */

function songMove(ctx: PlayCtx, cohortSongs: SongPick[]): PlanMove | null {
  const proven = cohortSongs.filter((s) => s.strength === "proven" && !s.fromOwn);
  if (!proven.length) return null;
  // Everything carried by two-plus accounts is equal evidence, so the ordering
  // among them is spread per handle rather than fixed.
  const top = spread(proven, ctx.handle).slice(0, 3);
  const names = top.map((s) => `“${s.title}”`);
  const listed =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const accounts = [...new Set(top.flatMap((s) => s.accounts))].length;

  return {
    id: "songs",
    priority: 0,
    title: `Cover ${top[0].title} — it worked for ${accounts} accounts your size`,
    why: `These are the songs that broke out for accounts your size, not for accounts ten times bigger: ${top
      .map((s) => `${s.title} (${s.accounts.length} accounts, ${s.medianRatio.toFixed(1)}x their usual)`)
      .join("; ")}. On a cover the song does most of the work — the edit only decides how far it goes.`,
    action: `Pick one of ${listed} for your next cover. Start on the line people already know — no spoken intro, song title on screen in the first second.`,
    evidence: top.flatMap((s) => evidenceFromSong(s, 1)).slice(0, 3),
  };
}

/**
 * The song to try when nothing is proven yet.
 *
 * "Proven" means two separate accounts broke out with the same song. In a young
 * niche there may be only a dozen posts, so that bar can leave a singer with no
 * song at all — and "what should I sing next" is the only question they have.
 *
 * So a single strong signal is still offered, but it is worded as a signal and
 * never as a record: one account is that creator's luck, not a pattern. This
 * move only appears when nothing is proven, so it can never outrank evidence.
 */
function songTryMove(ctx: PlayCtx, cohortSongs: SongPick[]): PlanMove | null {
  const first = spread(
    cohortSongs
      .filter((s) => s.strength === "promising" && !s.fromOwn)
      .sort((a, b) => b.medianRatio - a.medianRatio)
      // Only songs in the same league as the best one are worth rotating
      // between; spreading into weak signals would trade quality for variety.
      .filter((s) => s.medianRatio >= 1.5),
    ctx.handle,
  );
  if (!first.length) return null;

  const top = first[0];
  const best = top.evidence[0];
  if (!best) return null;

  return {
    id: "song-try",
    priority: 0,
    title: `Try “${top.title}” next — one account your size broke out with it`,
    why: `Only one account in your size range has posted this, so treat it as a signal rather than a sure thing: @${best.account} did ${best.ratio.toFixed(
      1,
    )}x their usual views with it. The song is doing the work on a cover — a proven pick would be safer, but waiting for one can mean posting nothing.`,
    action: `Sing the part everyone knows — usually the hook, not the opening verse — and put the song title on screen in the first second. If it lands, do a second angle on it in two weeks.`,
    evidence: [evidenceFromSong(top, 1)[0]].filter(Boolean) as PlanEvidence[],
  };
}

/** A song that already worked for THEM is the strongest possible bet. */
function repeatMove(ctx: PlayCtx, ownSongs: SongPick[]): PlanMove | null {
  const winner = ownSongs.filter((s) => s.medianRatio >= 1.5 && s.fromOwn)[0];
  if (!winner) return null;
  const best = winner.evidence[0];
  /**
   * Which denominator this rests on. With two or more of their own posts the
   * claim is about their own audience ("your usual views"). With one post there
   * is no usual, and the honest comparison is the space they post in — saying
   * "your usual views" there would be a number we never measured.
   */
  const ownBase = winner.basis !== "niche";
  const against = ownBase
    ? "your usual views"
    : "the typical post in your space";
  return {
    id: "repeat",
    priority: 0,
    title: `Your audience already said yes to “${winner.title}” — do it again, differently`,
    why: `That cover did ${winner.medianRatio.toFixed(
      1,
    )}x ${against}. When a song lands once for your audience, a second angle on the same song usually lands too — a different section, a different setting, or a duet.`,
    action: `Post “${winner.title}” again within two weeks: full version, a different verse, or a second voice on it. Keep the same opening.`,
    evidence: [
      {
        handle: `@${best.account}`,
        metric: `${best.ratio.toFixed(1)}x ${against} · ${fmt(best.views)} views`,
        url: best.url,
        caption: best.caption,
      },
    ],
  };
}

/** Numbered runs, only when the cohort actually runs them. */
function seriesMove(ctx: PlayCtx): PlanMove | null {
  /**
   * A numbered post that did HALF its account's usual views is not evidence for
   * numbering your posts. Only posts that at least held their own are counted,
   * so the proof never argues against the advice.
   */
  const numbered = ctx.rows.filter((r) => SERIES.test(r.reel.caption) && r.ratio >= 1);
  const accounts = [...new Set(numbered.map((r) => r.account))];
  if (numbered.length < 2 || accounts.length < 2) return null;
  const best = numbered.slice().sort((a, b) => b.ratio - a.ratio)[0];
  return {
    id: "series",
    priority: 0,
    title: `Run a numbered series — ${accounts.length} accounts your size already do`,
    why: `Posts numbered like a run ("Cover 28/100", "Day 24/30") keep showing up among the ones breaking out for accounts your size. A number in the caption is a reason to come back for the next one, and it makes the account look active.`,
    action:
      "Number your next 10 covers in the caption and commit to finishing the run. Say the number on screen in the first second.",
    evidence: numbered
      .slice()
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 3)
      .map(evidenceFrom),
  };
}

/**
 * Covers versus originals, measured on the creator's own reels. Most singers
 * discover they are spending half their output on the format that reaches a
 * tenth as far.
 */
function formatSplitMove(ctx: PlayCtx): PlanMove | null {
  const original = ctx.own.filter((r) => /\boriginal\b/i.test(r.caption) && r.views > 0);
  const cover = ctx.own.filter((r) => /\bcover\b/i.test(r.caption) && r.views > 0);
  if (original.length < 1 || cover.length < 2) return null;
  const ov = median(original.map((r) => r.views));
  const cv = median(cover.map((r) => r.views));
  if (!ov || !cv || cv < ov * 1.6) return null;
  const bestCover = cover.slice().sort((a, b) => b.views - a.views)[0];
  return {
    id: "split",
    priority: 0,
    title: `Your covers reach ${(cv / ov).toFixed(1)}x what your originals reach`,
    why: `Your covers land around ${fmt(cv)} views; your originals around ${fmt(
      ov,
    )}. That is not a verdict on the songs — it is what this audience is here for right now.`,
    action:
      "Keep covers as the growth engine and put originals out as the occasional one, introduced as an original so the drop in reach is expected rather than confusing.",
    evidence: [
      {
        handle: `@${bestCover.account}`,
        metric: `${fmt(bestCover.views)} views · your best cover`,
        url: bestCover.url,
        caption: bestCover.caption.replace(/\s+/g, " ").slice(0, 120),
      },
    ],
  };
}

/** Staying in the language the audience already follows you for. */
function languageMove(ctx: PlayCtx): PlanMove | null {
  const lang = ctx.archetype.language;
  if (!lang) return null;
  const inLangOf = (rows: Row[]) =>
    rows.filter((r) =>
      new RegExp(`\\b${lang}`, "i").test(
        `${r.reel.caption} ${(r.reel.hashtags ?? []).join(" ")}`,
      ),
    );

  // Measure against the posts that broke out when there are enough of them, and
  // say which pool was measured — "of the posts breaking out" and "of the posts
  // I compared" are different claims.
  const breakouts = ctx.rows.filter((r) => r.ratio >= 1.5);
  const useBreakouts = breakouts.length >= 3;
  const pool = useBreakouts ? breakouts : ctx.rows;
  const inLang = inLangOf(pool);
  if (inLang.length < 3) return null;
  const share = Math.round((inLang.length / Math.max(pool.length, 1)) * 100);
  if (share < 55) return null;
  const best = inLang.slice().sort((a, b) => b.ratio - a.ratio)[0];
  return {
    id: "language",
    priority: 0,
    title: `${share}% of what breaks out around you is in ${titleCase(lang)}`,
    why: `${share}% of the ${
      useBreakouts ? "posts breaking out around you" : "posts I compared"
    } are ${titleCase(
      lang,
    )}. Posting outside it puts you in a different feed with different competition.`,
    action: `Keep your next five covers in ${titleCase(
      lang,
    )}. If you want to reach another language, do it as a second, clearly-labelled series rather than by switching.`,
    evidence: [evidenceFrom(best)],
  };
}

/* ------------------------------------------------------------------ *
 * The opening line, for accounts where there is one
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * The floor: a move that is always available
 * ------------------------------------------------------------------ */

/**
 * The post of the creator's own that beat everything else they made.
 *
 * Every move above needs a cohort to point at, and a cohort can be too thin to
 * prove anything — a space where each account has only been read once has no
 * breakouts in it at all, so every measured move was dropped for lack of a
 * receipt and the page came out blank. A visitor who types their handle and
 * gets an empty page does not conclude "not enough data"; they conclude the
 * product does not work.
 *
 * This move needs no cohort. It compares the account with itself, which is
 * always possible once someone has posted more than once.
 */
function ownBestMove(ctx: PlayCtx): PlanMove | null {
  const posted = ctx.own.filter((r) => r.views > 0);
  if (posted.length < 2 || !ctx.ownMedian) return null;
  const best = posted.slice().sort((a, b) => b.views - a.views)[0];
  const ratio = best.views / ctx.ownMedian;
  // A 1.2x "winner" is noise in their own numbers, not a pattern to repeat.
  if (ratio < 1.5) return null;

  const gist = best.caption.replace(/\s+/g, " ").trim().slice(0, 70);

  /**
   * How much a single best post actually proves.
   *
   * The first version of this move treated every winner the same: "your best
   * post did Nx your usual — that is the one to repeat". That is honest advice
   * at 3x. At 4,000x it is wrong twice over. A post that beat an account's own
   * median by three orders of magnitude was almost certainly carried by
   * something outside the account's control — a big page resharing it, an
   * algorithmic push, a trending sound — and telling someone to "repeat it"
   * sends them to copy a thing that was never theirs to repeat. Worse, it
   * buries the real signal: that they have one outlier and no second data
   * point, which is a question, not a plan.
   *
   * So the move changes shape with the size of the outlier. Under 10x it is a
   * pattern to repeat. Between 10x and 100x it is a strong lead to study once.
   * Past 100x it is a fluke to investigate, and the advice says so.
   */
  const fluke = ratio >= 100;
  const lead = ratio >= 10 && ratio < 100;

  const repeat =
    ctx.archetype.recommendation === "songs"
      ? "Make another cover in the lane this one sits in — same artist, same language, same era — rather than a different kind of song."
      : ctx.archetype.recommendation === "formats"
        ? "Make another video in this exact shape: same structure, same kind of opening, different day."
        : ctx.archetype.recommendation === "craft"
          ? "Shoot the same kind of finished result again — same framing of the result, a different subject."
          : ctx.archetype.recommendation === "hooks"
            ? "Open the next one the way this one opens — same first line, different topic."
            : "Make one more post in this shape before trying anything new.";

  const action = fluke
    ? "Before copying it, check what actually happened: was it reshared by a bigger account, did it land on a trending sound, or did someone with an audience comment on it? Post one close variation and watch whether it behaves like your normal posts or like this one. One more data point tells you whether you have a format or a one-off."
    : lead
      ? `Run this shape once more on purpose — same structure, different subject — and treat that as the test. ${repeat}`
      : repeat;

  return {
    id: "ownbest",
    priority: 0,
    title: fluke
      ? `Your best post did ${times(ratio)} your usual views — treat that as an outlier to explain, not a formula yet`
      : lead
        ? `Your best post did ${times(ratio)} your usual views — worth testing once more`
        : `Your own best post did ${times(ratio)} your usual views — that is the one to repeat`,
    why: fluke
      ? `Your posts land around ${fmt(ctx.ownMedian)} views; this one did ${fmt(
          best.views,
        )}. A gap that size is usually something outside the post itself — a reshare, a push, a trending sound. That does not make it useless; it makes it a clue to check before you rebuild your week around it.`
      : `Your posts land around ${fmt(ctx.ownMedian)} views; this one did ${fmt(
          best.views,
        )}. Nothing else you have posted has closed that gap, so it is the clearest signal your own account has given.`,
    action,
    evidence: [
      {
        handle: `@${best.account}`,
        metric: `${times(ratio)} your usual views · ${fmt(best.views)} views`,
        url: best.url,
        caption: gist || undefined,
      },
    ],
  };
}

/**
 * When even the account's own numbers are too few to compare (a single post),
 * the strongest post in the space is still something to aim at — said plainly
 * as a target, never as a verdict on the account.
 */
function cohortBestMove(ctx: PlayCtx): PlanMove | null {
  const rows = ctx.rows.filter((r) => r.reel.views > 0);
  if (!rows.length) return null;
  const family = ctx.archetype.recommendation;

  /**
   * A singer is shown the strongest post that NAMES ITS SONG, not the strongest
   * post full stop. The biggest post in a music niche is routinely a crowd shot
   * or a festival greeting with no song in the caption, and taking it at face
   * value is what produced "post on the idea behind the biggest post here" — a
   * line with no music in it, handed to a singer. Where nothing in the space
   * names a song at all, the plain strongest post is still used and the wording
   * stays honest about what it is.
   */
  const songRows = family === "songs" ? rows.filter((r) => songOf(r.reel)) : [];
  const pool = songRows.length ? songRows : rows;
  const best = pool.slice().sort((a, b) => b.reel.views - a.reel.views)[0];
  const gist = best.reel.caption.replace(/\s+/g, " ").trim().slice(0, 70);
  const song = family === "songs" ? songOf(best.reel) : null;
  /**
   * The title used to state a fact ("the biggest post in your space is 41k
   * views") and leave the doing to the body. A title is the thing a reader
   * acts on, so it is phrased as the instruction the action line supports —
   * otherwise a thin account's whole plan read as a statistic.
   */
  const title = song
    ? `Cover “${song}” — it is the biggest post in your space (${fmt(best.reel.views)} views)`
    : family === "formats"
      ? `Copy the shape of the biggest post in your space — ${fmt(best.reel.views)} views`
      : family === "craft"
        ? `Show the same result as the biggest post in your space — ${fmt(best.reel.views)} views`
        : family === "hooks"
          ? `Open your next post the way the biggest post here does — ${fmt(best.reel.views)} views`
          : `Post on the idea behind the biggest post here — ${fmt(best.reel.views)} views`;
  const action = song
    ? `Do your own version of “${song}” and put the title on screen in the first frame.`
    : family === "formats"
      ? "Make one video with the same shape as this one — same structure, same kind of opening, your own subject."
      : family === "craft"
        ? "Make the same kind of finished result this one shows, with your own subject in frame."
        : family === "hooks"
          ? "Open your next post the way this one opens, with your own topic behind it."
          : "Make one post on the same idea, in your own format, and put your own number next to it when it lands.";

  return {
    id: "strongest",
    priority: 0,
    title,
    why: songRows.length
      ? `There are not enough posts from accounts your size to compare you with yet, so this is the strongest post among the ${rows.length} I read here that names its song. It is a target, not a judgement of your account.`
      : `There are not enough posts from accounts your size to compare you with yet, so this is the strongest single post among the ${rows.length} I read here. None of them named a song, so treat this as the target rather than a pick.`,
    action,
    evidence: [
      {
        handle: `@${best.account}`,
        metric: `${fmt(best.reel.views)} views · biggest in this space`,
        url: best.reel.url,
        caption: gist || undefined,
      },
    ],
  };
}

/**
 * The move that names other accounts.
 *
 * Every plan is supposed to answer "what is working for accounts like me, and
 * what do I do about it". When the cohort's reels were thin the assembly fell to
 * its floor, `ownBestMove` — "your own best post did 3x your usual, repeat it" —
 * and that was the *whole* plan. Real, measured, and useless as a weekly
 * recommendation: it tells a creator to redo work they have already done, and it
 * never once mentions another account, which is the only thing they cannot see
 * for themselves.
 *
 * So the cohort gets its own move, built from its own winners. It is ranked by
 * how far each post beat *that account's* usual views, which is what makes an
 * account of any size comparable, and it requires nothing from the outlier gate
 * the rest of the plan uses — the cohort's best post is evidence on its own.
 */
function peerLeaderMove(ctx: PlayCtx): PlanMove | null {
  if (!ctx.peers.length) return null;
  const peerSet = new Set(ctx.peers.map((p) => p.handle.toLowerCase()));
  const rows = ctx.rows.filter((r) => peerSet.has(r.account.toLowerCase()) && r.ratio > 0);
  if (!rows.length) return null;

  /** One post per account: a single account's four hits is still one account. */
  const best = new Map<string, Row>();
  for (const r of rows) {
    const key = r.account.toLowerCase();
    const seen = best.get(key);
    if (!seen || r.ratio > seen.ratio) best.set(key, r);
  }
  const leaders = [...best.values()].sort((a, b) => b.ratio - a.ratio);
  if (!leaders.length) return null;

  const top = leaders[0];
  const second = leaders[1];
  const topShape = detectFormat(top.reel);
  const secondShape = second ? detectFormat(second.reel) : null;
  const shape = topShape ? videoFormat(topShape) : undefined;

  /**
   * Two accounts on the same shape is a pattern; two accounts on different
   * shapes is two options. The wording has to follow, or the page claims a
   * convergence that is not there.
   */
  const shared = Boolean(
    topShape && secondShape && topShape === secondShape && second && second.ratio >= 1.3,
  );
  const breadth = new Set(leaders.map((l) => l.account.toLowerCase())).size;
  const who = `@${top.account}${second && !shared ? ` and @${second.account}` : ""}`;
  /**
   * The noun follows the evidence. "Accounts your size" is only allowed when
   * the cohort was banded by follower count; otherwise the sentence names the
   * room it actually measured, so the number and the claim cannot part ways.
   */
  const band = ctx.sizeMatched ? "accounts your size" : "other accounts in this space";

  /**
   * The subject, not only the account.
   *
   * "Make what @nasa made" names the competitor and says nothing about what to
   * make — the creator is told to copy a post they have never seen, and the one
   * piece of information that would make the move actionable (the caption of the
   * post that broke out) was sitting in the evidence array, unread. The gist
   * leads now, so the move can be judged and acted on without opening a link.
   */
  const idea = top.reel.caption.replace(/\s+/g, " ").trim();
  const gist = idea.length > 90 ? `${idea.slice(0, 88).trimEnd()}…` : idea;
  const ideaLine = gist ? `“${gist}”` : null;

  const title = shared && shape
    ? `${shape.label} is working for ${band} — ${breadth} broke out with it${
        ideaLine ? `, @${top.account} with ${ideaLine}` : ""
      }`
    : ideaLine
      ? `Make your version of @${top.account}'s ${fmt(top.reel.views)}-view post: ${ideaLine}`
      : `Make what ${who} made — the strongest post among ${breadth} ${band}`;

  const why = shared && shape
    ? `Your own account is not the only evidence here. ${breadth} account${
        breadth === 1 ? "" : "s"
      } in your comparison posted ${shape.label.toLowerCase()} and beat their own usual views — ${top.account} by ${top.ratio.toFixed(
        1,
      )}x. That is the shape travelling, not one lucky post.`
    : `This is measured outside your account: the strongest post among ${breadth} ${band} did ${top.ratio.toFixed(
        1,
      )}x its own usual views${
        second ? `, and ${second.account} did ${second.ratio.toFixed(1)}x` : ""
      }. Copying a shape that already works for someone else is cheaper than inventing one.`;

  const action = shape
    ? `Make one ${shape.label.toLowerCase()} this week — ${shape.what.replace(/\.$/, "")}. Take the subject from @${top.account}${
        ideaLine ? ` — ${ideaLine}` : ""
      }` + " and put your own footage behind it."
    : `Make one post with @${top.account}'s structure${
        ideaLine ? ` and its subject — ${ideaLine}` : ""
      } — same kind of opening, same build — with your own subject in it.`;

  return {
    id: "cohort-leader",
    priority: 0,
    title,
    why,
    action,
    evidence: leaders.slice(0, 3).map(evidenceFrom),
  };
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

export interface PlayResult {
  moves: PlanMove[];
  /** cohort songs, strongest first — shown as its own section for singers */
  songs: SongPick[];
  ownSongs: SongPick[];
  /** video shapes worth making more of, for accounts where the shape is the lever */
  formats: FormatPick[];
  /** opening-line shapes worth reusing, for accounts where the line is the lever */
  hooks: HookPick[];
}

/**
 * Assemble the plan. The first decision is the family, because that decides what
 * the lead recommendation even is: a song, a video shape, an opening line, or a
 * reveal. Everything after that is shared measurement.
 *
 * A move that cannot cite a post is dropped here, not softened. That is what
 * stops an unreadable account from being handed confident nonsense.
 */
export function buildPlay(ctx: PlayCtx): PlayResult {
  const family = ctx.archetype.recommendation;
  const songLed = family === "songs";

  /**
   * A singer is judged on a lower single-account bar than everyone else. For
   * other accounts a song is one option among several, so one account's hit is
   * not enough to build a plan on. For a singer it is the only lever, and a song
   * that beat its own account's usual views is a real signal even when only one
   * account carries it — the move is worded as a signal, never as a record.
   */
  let songs = songLed
    ? rankSongs(ctx.rows, ctx.handle, { minSingle: 1.5 }).filter((s) => !s.fromOwn)
    : [];

  /**
   * If nothing cleared the signal bar, a singer still gets the strongest song
   * their space actually posts rather than an empty "songs worth covering"
   * section beside a lead move that names a song. Ranked by how many accounts
   * posted it and then by how well it did, so the floor is the space's own
   * choice rather than a coin flip. No ratio floor here on purpose: in a
   * twelve-post niche every song has one account behind it, and the section has
   * to agree with the move that leads the plan.
   */
  if (songLed && !songs.length) {
    songs = rankSongs(ctx.rows, ctx.handle, { minSingle: 0 })
      .filter((s) => !s.fromOwn)
      .slice(0, 2);
  }
  const ownSongs = songLed
    ? ownSongWinners(ctx.own, ctx.ownMedian, ctx.nicheMedian ?? 0)
    : [];

  // Shapes are ranked for the two families whose lever is the video itself, and
  // used as a secondary, still-evidenced move for the rest.
  const shapes = rankFormats(ctx.rows, { family });

  // The parallel of songs and shapes for the third family: the same measurement,
  // applied to how a post opens rather than to what it is made of.
  const hooks = family === "hooks" ? rankHooks(ctx.rows) : [];

  const candidates: (PlanMove | null)[] = [];

  switch (family) {
    case "songs": {
      // Which song, then which song of yours, then the packaging around it.
      // A proven song leads; when none is proven the single-signal pick takes
      // that place instead, so a singer is never left without a song.
      const proven = songs.some((s) => s.strength === "proven" && !s.fromOwn);
      candidates.push(
        songMove(ctx, songs),
        proven ? null : songTryMove(ctx, songs),
        repeatMove(ctx, ownSongs),
        seriesMove(ctx),
        formatSplitMove(ctx),
        languageMove(ctx),
        lengthMove(ctx),
        cadenceMove(ctx),
      );
      break;
    }

    case "formats":
      // The shape comes first: "what should I make more of" is the question a
      // vlogger actually has, and the answer is a kind of video, not a line.
      candidates.push(
        formatMove(ctx, shapes),
        seriesMove(ctx),
        themeMove(ctx),
        lengthMove(ctx),
        cadenceMove(ctx),
        languageMove(ctx),
      );
      break;

    case "craft":
      candidates.push(
        payoffMove(ctx),
        formatMove(ctx, shapes),
        seriesMove(ctx),
        themeMove(ctx),
        lengthMove(ctx),
        cadenceMove(ctx),
        languageMove(ctx),
      );
      break;

    case "hooks":
      // The opening line leads; the shape is offered second, on its own evidence.
      candidates.push(
        hookMove(ctx),
        themeMove(ctx),
        formatMove(ctx, shapes),
        lengthMove(ctx),
        cadenceMove(ctx),
        languageMove(ctx),
      );
      break;

    default:
      // Nothing is known well enough to lead with a lever, so the plan sticks to
      // what the numbers plainly say — and to the account's own best post,
      // which is the one lever that needs no category to justify.
      candidates.push(
        themeMove(ctx),
        ownBestMove(ctx),
        formatMove(ctx, shapes),
        lengthMove(ctx),
        cadenceMove(ctx),
        languageMove(ctx),
      );
  }

  const usable = candidates.filter(
    (m): m is PlanMove => Boolean(m) && Boolean(m!.evidence.length),
  );

  /**
   * A plan that never names another account is not a competitive read — it is a
   * mirror. That was the failure mode on a thin cohort: every candidate dropped
   * for want of receipts, the floor move took over, and the creator was told to
   * repeat their own best post with no comparison anywhere on the page.
   *
   * So the cohort's own winners are computed separately, and when nothing else
   * manages to cite another account it leads. When something does, it is kept as
   * a secondary move rather than dropped.
   */
  const cohort = peerLeaderMove(ctx);
  const citesPeer = (m: PlanMove) =>
    m.evidence.some((e) => e.handle.replace(/^@/, "").toLowerCase() !== ctx.handle.toLowerCase());
  if (cohort) {
    /**
     * Other accounts lead, always.
     *
     * This move used to be appended when something else already cited a peer, so
     * it could sit third behind two moves about the creator's own posting
     * cadence — and the week read as advice about themselves with a competitor
     * mentioned in passing. The one thing a creator cannot see from inside their
     * own analytics is what is working for someone else, so when we hold that
     * evidence it is the lead, not a footnote.
     */
    usable.unshift(cohort);

    /**
     * And the mirror goes.
     *
     * "Your own best post did 3x your usual views — repeat it" is measurable,
     * true, and useless as a weekly recommendation: it tells a creator to redo
     * work they have already done, and they can read it off their own dashboard
     * without us. It is dropped only when a move grounded in another account
     * exists to take its place, because a mirror week is still better than an
     * empty one.
     */
    const mirror = usable.findIndex((m) => m.id === "ownbest");
    if (mirror >= 0) usable.splice(mirror, 1);
  }

  /**
   * "Keep posting in Kannada" is a constraint, not a next step — it cannot be
   * the thing you go and do this week. It sat in the candidate list like any
   * other move, so on thin accounts it became the lead recommendation, and the
   * whole plan read "stay there". It is now never allowed to lead: it is placed
   * last, and only when there is room for it.
   */
  const language = usable.find((m) => m.id === "language") ?? null;
  let moves = dedupe(usable.filter((m) => m.id !== "language")).slice(0, 4);

  /**
   * A plan with no moves is a dead end for someone who just typed their handle.
   * Before giving up, fall back to the comparison that always exists: the
   * account against its own best post, or — with only one post to go on — the
   * strongest post in the space, stated as a target.
   */
  if (!moves.length) {
    const floor = ownBestMove(ctx) ?? cohortBestMove(ctx);
    if (floor) moves = [floor];
  }
  if (language && moves.length < 5) moves = [...moves, language];

  const ranked = moves.map((m, i) => ({ ...m, priority: i + 1 }));

  return {
    moves: ranked,
    songs,
    ownSongs,
    formats: family === "formats" || family === "craft" ? shapes : [],
    hooks,
  };
}

/** Songs the plan can quote in its diagnosis, if any. */
export function topSongTitle(songs: SongPick[]): string | null {
  return songs.find((s) => s.strength === "proven")?.title ?? null;
}

/** How many distinct songs the cohort's breakout posts were about. */
export function songCount(rows: Row[]): number {
  const set = new Set<string>();
  for (const r of rows) {
    const song = songOf(r.reel);
    if (song) set.add(song.toLowerCase());
  }
  return set.size;
}
