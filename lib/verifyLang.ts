import {
  accountProfile,
  commentsLanguage,
  inLanguage,
  isSuspect,
  readLanguage,
  type AccountLangProfile,
} from "./lang";
import { fetchInstagramPost } from "./harvest";
import { mediaReady, readHook } from "./media";
import type { RawReel } from "./types";

/**
 * Settling the reels the text cannot judge.
 *
 * A caption is the weakest possible evidence about what language a reel is in,
 * and on a cover it is often the opposite of the truth: "barbaad - saiyaara"
 * written in English over a Hindi film song. Tags are the creator's own filing
 * and they lie less, but plenty of accounts use none. Two witnesses are left,
 * and this pass asks both, in order of cost:
 *
 *   1. The video — free. The search row carries the MP4 link, whisper runs on
 *      this machine and macOS reads the frames, so the lyrics being sung and
 *      the words burned onto the frame can be read for nothing but seconds.
 *   2. The comments — 1 credit. The audience writes in the language of the
 *      song, and they write it in Latin letters ("Relatives nidhra poru emo"),
 *      which no script test and sometimes no transcript catches. Only reels the
 *      video could not settle are bought, only the biggest of those, and every
 *      list is kept on the reel so a rebuild never pays again.
 *
 * The reading stays one-sided, like the gate: a reel is dropped when a witness
 * positively contradicts the room, never because it stayed quiet. A visual reel
 * with no words at all has told us nothing and is left where it was.
 */

export interface WatchStats {
  /** reels whose text evidence was too thin to judge */
  candidates: number;
  /** reels actually downloaded and read */
  watched: number;
  /** reels the video proved were in another language */
  dropped: number;
  /** reels the video confirmed were in the room */
  confirmed: number;
  /** reels the video said nothing about */
  silent: number;
  /** why the pass did nothing, when it did nothing */
  skipped?: string;
  /** reels left as candidates with no MP4 to watch */
  noMedia?: number;
  /** posts bought for their comment section (1 credit each) */
  bought?: number;
  /** credits the comment phase spent — 0 when every comment list was already held */
  credits?: number;
  /** reels the comments proved were in another language */
  commentsDropped?: number;
  /** reels the comments confirmed were in the room */
  commentsConfirmed?: number;
  /** candidates still undecided after the video and the comments */
  leftover?: number;
}

export interface WatchResult {
  kept: RawReel[];
  dropped: { reel: RawReel; why: string }[];
  stats: WatchStats;
}

/**
 * Verdicts that rest on nothing but the caption, or on nothing at all.
 *
 * `ok:provider` belongs here: the provider's language tag tracks the caption,
 * so a reel kept on it is kept on the same weak evidence as an English one and
 * is worth a second witness — especially the big ones, which move the median.
 */
const WEAK = new Set(["unknown", "english-caption-unknown", "ok:english", "ok:provider"]);

/**
 * Reels whose verdict is not settled: kept on a caption, or on nothing at all,
 * or on an account that contradicts them. A `suspect:` reel is here on purpose
 * and is the most valuable member of the queue — it is one the gate would have
 * thrown out on the account's reputation alone, and the video is the only way
 * to keep the English single and still lose the Telugu film song.
 */
function unsettled(why: string): boolean {
  return WEAK.has(why) || isSuspect(why);
}

/** What a bought post has to give back for the comment phase to be worth it. */
export type PostBuyer = (url: string) => Promise<{
  topComments?: { text?: string | null }[];
  mediaUrl?: string;
}>;

export interface WatchOptions {
  /** how many reels may be downloaded; each is a few seconds of local work */
  max?: number;
  /** stop starting new reads after this long, so a page load cannot hang */
  budgetMs?: number;
  /** how many posts may be bought for their comments, 1 credit each */
  maxBought?: number;
  /** hard ceiling on credits the comment phase may spend */
  creditBudget?: number;
  /** injected by the test suite so it can prove the phase without spending */
  buyPost?: PostBuyer;
}

/**
 * Read the video for the reels the text could not settle, then the comments
 * under the ones the video could not settle either.
 *
 * Mutates the reels it reads — on-screen text, transcript, comments and a
 * media URL where one was missing are attached — so the verdict is reproducible
 * from cache later, in `shape()`, without downloading or buying anything again.
 */
export async function watchToVerify(
  reels: RawReel[],
  want: string | null,
  opts: WatchOptions = {},
): Promise<WatchResult> {
  const stats: WatchStats = {
    candidates: 0,
    watched: 0,
    dropped: 0,
    confirmed: 0,
    silent: 0,
    noMedia: 0,
    bought: 0,
    credits: 0,
    commentsDropped: 0,
    commentsConfirmed: 0,
  };

  if (!want) {
    return { kept: reels, dropped: [], stats: { ...stats, skipped: "the room has no language" } };
  }

  /**
   * The account profile is rebuilt here exactly as `shape()` builds it: a reel
   * judged against a different account context would get a different answer.
   */
  const byAccount = new Map<string, RawReel[]>();
  for (const r of reels) {
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }
  const profiles = new Map<string, AccountLangProfile | null>();
  for (const [handle, list] of byAccount) {
    const p = accountProfile(list, want);
    profiles.set(handle, p.mixed ? null : p);
  }
  const profileOf = (r: RawReel) => profiles.get(r.account) ?? null;
  const verdictOf = (r: RawReel) => inLanguage(r, want, profileOf(r));

  const queued = reels
    .filter((r) => r.platform === "instagram")
    .filter((r) => unsettled(verdictOf(r).why))
    // The biggest reels first: they are the ones that move the median and end
    // up cited, so they are the ones worth a second witness.
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  stats.candidates = queued.length;
  stats.noMedia = queued.filter((r) => !r.mediaUrl).length;

  const dropped: { reel: RawReel; why: string }[] = [];
  const drop = (reel: RawReel, why: string) => {
    dropped.push({ reel, why });
    stats.dropped += 1;
    settled.add(reel.id);
  };

  /**
   * A reel is settled once something decided it — dropped, or confirmed by a
   * witness that could see the reel itself. Confirming matters for the last
   * count: a reel whose comments agree with the room is answered, and reporting
   * it as "still unconfirmed" would understate the pass and re-buy it next run.
   */
  const settled = new Set<string>();
  const confirmedByComments = (r: RawReel) =>
    (commentsLanguage(r.comments, r.topComments)?.code ?? null) === want;

  /* ------------------------------------------------------------------ video */

  const canWatch = mediaReady();
  const max = opts.max ?? 8;
  const budgetMs = opts.budgetMs ?? 90_000;
  const started = Date.now();

  for (const reel of queued) {
    if (!reel.mediaUrl) continue;
    if (!canWatch) break;
    if (stats.watched >= max || Date.now() - started > budgetMs) break;

    stats.watched += 1;
    /**
     * `readHook` is the reader that already exists for the hook question, and
     * its answer is cached by reel URL — so a reel watched here is free to read
     * again when the plan asks where its hook lives.
     */
    const reading = await readHook({ reel, mediaUrl: reel.mediaUrl });
    const onScreen = reading.onScreen?.join(" · ").slice(0, 400);
    const spoken = reading.spoken?.slice(0, 600);
    if (onScreen) reel.onScreenText = onScreen;
    if (spoken) reel.spoken = spoken;
    if (reading.heardLang) {
      reel.heardLang = reading.heardLang;
      reel.heardLangProb = reading.heardLangProb;
    }

    /**
     * What the video said, on its own — not the caption read again. Crediting a
     * confirmation that came from the caption would make this pass look like it
     * had settled something it never saw.
     */
    const fromVideo = readLanguage({
      onScreenText: onScreen,
      spoken,
      heardLang: reading.heardLang,
      heardLangProb: reading.heardLangProb,
    });
    if (!fromVideo.code) {
      stats.silent += 1;
      continue;
    }

    const verdict = verdictOf(reel);
    if (!verdict.keep) drop(reel, `video:${fromVideo.code}`);
    else if (fromVideo.code === want) {
      stats.confirmed += 1;
      settled.add(reel.id);
    } else stats.silent += 1;
  }

  /* --------------------------------------------------------------- comments */

  /**
   * What is left are reels whose caption said nothing usable and whose video
   * said nothing usable — or which had no video to watch at all. The comments
   * are the last witness: the audience under a Telugu song writes Telugu, and
   * under an English cover writes English, whatever the caption claims.
   *
   * This is the one paid step in the pass, so it is bounded three ways: only
   * reels still undecided, only the biggest of those, and only while the credit
   * ceiling holds. A post bought here also carries the MP4, so a reel that had
   * no media URL gets its video read as well.
   */
  const buyer: PostBuyer = opts.buyPost ?? ((url) => fetchInstagramPost(url));
  const maxBought = opts.maxBought ?? 4;
  const creditBudget = opts.creditBudget ?? 4;

  const droppedIds = new Set(dropped.map((d) => d.reel.id));
  const undecided = () =>
    queued.filter(
      (r) => !droppedIds.has(r.id) && !settled.has(r.id) && unsettled(verdictOf(r).why),
    );

  for (const reel of undecided()) {
    if ((stats.bought ?? 0) >= maxBought || (stats.credits ?? 0) >= creditBudget) break;
    if (!reel.url) continue;

    // A comment list already in hand is free evidence; the gate reads it.
    if (reel.topComments?.length) {
      const verdict = verdictOf(reel);
      if (!verdict.keep) {
        drop(reel, verdict.why);
        droppedIds.add(reel.id);
        stats.commentsDropped = (stats.commentsDropped ?? 0) + 1;
      } else if (confirmedByComments(reel)) {
        stats.commentsConfirmed = (stats.commentsConfirmed ?? 0) + 1;
        settled.add(reel.id);
      }
      continue;
    }

    try {
      const post = await buyer(reel.url);
      stats.bought = (stats.bought ?? 0) + 1;
      stats.credits = (stats.credits ?? 0) + 1;
      const comments = (post.topComments ?? [])
        .filter(
          (c): c is { text: string } => typeof c?.text === "string" && Boolean(c.text.trim()),
        )
        .map((c) => ({ text: c.text, likes: 0 }));
      if (comments.length) reel.topComments = comments;
      if (!reel.mediaUrl && post.mediaUrl) reel.mediaUrl = post.mediaUrl;
    } catch {
      /**
       * A failed buy must not cost the reel its place — nothing was learned, so
       * nothing is dropped — and it must not be counted as money either.
       */
      continue;
    }

    let verdict = verdictOf(reel);
    if (!verdict.keep) {
      drop(reel, verdict.why);
      droppedIds.add(reel.id);
      stats.commentsDropped = (stats.commentsDropped ?? 0) + 1;
      continue;
    }
    if (confirmedByComments(reel)) {
      stats.commentsConfirmed = (stats.commentsConfirmed ?? 0) + 1;
      settled.add(reel.id);
    }

    /**
     * Still undecided, but the buy may have handed us a video that was never
     * readable before. Watch it now rather than leave a paid reel half-read.
     */
    if (unsettled(verdict.why) && reel.mediaUrl && canWatch && stats.watched < max) {
      stats.watched += 1;
      const reading = await readHook({ reel, mediaUrl: reel.mediaUrl });
      const onScreen = reading.onScreen?.join(" · ").slice(0, 400);
      const spoken = reading.spoken?.slice(0, 600);
      if (onScreen) reel.onScreenText = onScreen;
      if (spoken) reel.spoken = spoken;
      if (reading.heardLang) {
        reel.heardLang = reading.heardLang;
        reel.heardLangProb = reading.heardLangProb;
      }
      const fromVideo = readLanguage({
        onScreenText: onScreen,
        spoken,
        heardLang: reading.heardLang,
        heardLangProb: reading.heardLangProb,
      });
      if (!fromVideo.code) {
        stats.silent += 1;
        continue;
      }
      verdict = verdictOf(reel);
      if (!verdict.keep) {
        drop(reel, `video:${fromVideo.code}`);
        droppedIds.add(reel.id);
      } else if (fromVideo.code === want) {
        stats.confirmed += 1;
        settled.add(reel.id);
      } else stats.silent += 1;
    }
  }

  stats.leftover = undecided().length;

  const kept = reels.filter((r) => !droppedIds.has(r.id));
  return { kept, dropped, stats };
}
