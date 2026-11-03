/**
 * The profile view: one pure function that turns a saved plan into the
 * six-section profile page.
 *
 * `buildProfileView` is the only place the page reads a plan. It is deliberately
 * pure — no vendor, no database, no clock — so the winners/flops split, the
 * ratios and the comment intelligence are unit-tested without a network.
 * Everything that reaches a string goes through `plain()`, and in a competitor
 * view every sentence this product wrote is third person, while the account's
 * captions and the audience's comments stay byte-for-byte.
 *
 * The plan is the source of truth. Where it is missing a field (older plans were
 * written before reels were retained) the page says so instead of printing a
 * number that was never read.
 */
import { neutralisePerson } from "./competitor";
import { compact, times } from "./fmt";
import { languageName } from "./lang";
import { plain, sentenceCase } from "./plain";
import type { GrowthPlan, PlanCompetitor, RawReel } from "./types";
import { hookLine, shortcodeFromUrl, type ReelToRead, type VideoReading } from "./videoReader";

/**
 * Whether the niche label is "verified" — the cohort check confirmed the room
 * actually matches the account. A model guess, a hashtag or a shape read is
 * still a guess; only `nicheFit.verdict === "matches"` earns the word.
 */
export function nicheIsVerified(verdict: string | undefined): boolean {
  return verdict === "matches";
}

export interface ProfileBotEstimate {
  realPct: number;
  sample: number;
  confidence: "low" | "medium" | "high";
}

export interface ProfileVitals {
  followers?: number;
  /** likes / views across the reels read, or null when no reel carried both */
  likesRatio: number | null;
  /** average likes per reel read, or null */
  avgLikes: number | null;
  /** comments / views across the reels read, or null when no reel carried both */
  commentRatio: number | null;
  /** average comments per reel read, or null */
  avgComments: number | null;
  /** how many reels the ratios were computed from ("of N recent reels") */
  reelsRead: number;
  /**
   * The bot-to-real estimate, when the account was large and public enough to
   * sample. `null` means "not estimated" — the slab says why instead of showing
   * a made-up percentage.
   */
  botToReal: ProfileBotEstimate | null;
}

export interface ProfileDna {
  /** an executive summary of niche positioning, from the plan's own prose */
  summary: string;
  /** languages in comments and what the audience asks for */
  audienceSignals: string[];
}

export interface ReelCard {
  url: string;
  views: number;
  /** null when the plan did not carry a like count for this reel */
  likes: number | null;
  /** null when the plan did not carry a comment count for this reel */
  comments: number | null;
  /** the "why it worked / flopped" bullets, in plain words */
  why: string[];
  /**
   * What the bullets rest on: the video itself, or the caption and the numbers.
   * The card prints this, so a viewer never mistakes a caption guess for a
   * watched video.
   */
  basis: "video" | "captions";
}

export interface CommentIntel {
  /** the audience mood split, by share of what was read */
  mood: { label: string; pct: number }[];
  /** the top recurring viewer requests, with mention counts */
  requests: { text: string; mentions: number }[];
}

export interface ProfileIdea {
  fromHandle: string;
  /**
   * Instagram-only by construction. Stored on each idea so the shared store can
   * reject a legacy or non-Instagram idea rather than serve it.
   */
  platform: "instagram";
  /** display-ready: the competitor's views, or "views unknown" */
  theirViews: string;
  /** why that competitor was chosen */
  whyChosen: string[];
  /** the concept to script (the competitor's caption) */
  concept: string;
  /** /chat?action=script&idea=<1-based index>&handle=<handle> */
  scriptHref: string;
}

export interface ProfileNextMove {
  title: string;
  why: string;
  action: string;
  stop?: string;
}

export interface ProfileView {
  handle: string;
  niche: string;
  /** "verified niche" badge only when the niche was derived from the posts */
  nicheVerified: boolean;
  vitals: ProfileVitals;
  dna: ProfileDna;
  winners: ReelCard[];
  flops: ReelCard[];
  commentIntel: CommentIntel | null;
  ideas: ProfileIdea[];
  /**
   * The comparison the numbers rest on, kept out of the creator summary and
   * shown as a footnote under the vitals: "Compared with N accounts: <basis>."
   * Absent when there is no cohort or no basis worth stating.
   */
  comparison?: string;
  own: boolean;
  /** only for the owner's own plan: the single thing to do this week */
  nextMove?: ProfileNextMove;
}

/** A reel as the plan holds it, with the counts it may not have carried. */
export interface PlanReel {
  url: string;
  views: number;
  likes?: number;
  comments?: number;
  /** kept so the video reader has something to fall back to */
  caption?: string;
  /** the signed CDN link the plan carried for this reel, when it did */
  mediaUrl?: string;
}

const ROUND = (n: number): number => Number(n.toFixed(4));

function median(xs: number[]): number {
  const list = xs
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/** A reported count, or undefined when the payload did not carry one. */
function count(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function fromRaw(reel: RawReel): PlanReel {
  return {
    url: reel.url,
    views: reel.views,
    likes: count(reel.likes),
    comments: count(reel.comments),
    caption: reel.caption,
    mediaUrl: reel.mediaUrl,
  };
}

/**
 * The reels the plan actually holds.
 *
 * New plans keep the account's own reels (`plan.reels`). Older plans carry only
 * the audit's best and worst posts, which have views but no like or comment
 * count; those are reconstructed with the counts absent, so the cards say
 * "likes unavailable" rather than zero. A plan with neither yields an empty
 * list, which the page turns into the explanatory empty state.
 */
function reelsFromPlan(plan: GrowthPlan): PlanReel[] {
  const seen = new Set<string>();
  const out: PlanReel[] = [];

  const add = (reel: PlanReel) => {
    if (!reel.url || seen.has(reel.url) || !(reel.views > 0)) return;
    seen.add(reel.url);
    out.push(reel);
  };

  for (const reel of plan.reels ?? []) add(fromRaw(reel));

  if (!out.length) {
    if (plan.audit?.best) {
      add({
        url: plan.audit.best.url,
        views: plan.audit.best.views,
        caption: plan.audit.best.caption,
      });
    }
    if (plan.audit?.worst) {
      add({
        url: plan.audit.worst.url,
        views: plan.audit.worst.views,
        caption: plan.audit.worst.caption,
      });
    }
  }

  return out;
}

/** One decimal of a share, e.g. 0.074 -> "7.4%"; tiny real shares never read 0.0%. */
function share1(fraction: number): string {
  const pct = fraction * 100;
  if (!Number.isFinite(pct) || pct <= 0) return "0.0%";
  if (pct < 0.05) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

/**
 * The "why it worked / flopped" bullets.
 *
 * Only two kinds of claim are allowed: the arithmetic against the account's own
 * usual views, and the engagement each reel actually carried against the
 * account's own average. Nothing here describes a video that was not watched.
 */
function whyBullets(
  reel: PlanReel,
  usualViews: number,
  avgLikeShare: number,
  avgCommentShare: number,
  own: boolean,
  weakest: boolean,
): string[] {
  const out: string[] = [];
  const whose = own ? "your" : "the account's";

  if (usualViews > 0) {
    const multiple = reel.views / usualViews;
    out.push(
      multiple >= 1
        ? `Did ${times(multiple)} ${whose} usual views`
        : `Reached ${times(multiple)} ${whose} usual views`,
    );
  }

  if (reel.likes !== undefined && reel.views > 0 && avgLikeShare > 0) {
    const share = reel.likes / reel.views;
    const relative = share / avgLikeShare;
    if (relative >= 1.15) {
      out.push(
        `Likes ran at ${share1(share)} of views, above the account's ${share1(avgLikeShare)} average`,
      );
    } else if (relative <= 0.85) {
      out.push(
        `Likes ran at ${share1(share)} of views, below the account's ${share1(avgLikeShare)} average`,
      );
    }
  }

  if (reel.comments !== undefined && reel.views > 0 && avgCommentShare > 0) {
    const share = reel.comments / reel.views;
    /**
     * Below one comment per thousand views both shares round to "<0.1%", so a
     * comparison would read "below the account's <0.1% average" — a sentence
     * with no information. Stay quiet instead.
     */
    if (share >= 0.001 || avgCommentShare >= 0.001) {
      const relative = share / avgCommentShare;
      if (relative >= 1.15) {
        out.push(
          `Comments ran at ${share1(share)} of views, above the account's ${share1(avgCommentShare)} average`,
        );
      } else if (relative <= 0.85) {
        out.push(
          `Comments ran at ${share1(share)} of views, below the account's ${share1(avgCommentShare)} average`,
        );
      }
    }
  }

  if (weakest && out.length && out[0]?.startsWith("Did ")) {
    out.push("Still among the weakest of the reels read");
  }

  if (!out.length) {
    out.push(
      weakest
        ? `One of the weakest of ${own ? "your" : "the account's"} reels read`
        : `One of the strongest of ${own ? "your" : "the account's"} reels read`,
    );
  }

  return out.map((line) => plain(line));
}

function toReelCard(
  reel: PlanReel,
  usualViews: number,
  avgLikeShare: number,
  avgCommentShare: number,
  own: boolean,
  weakest: boolean,
  reading?: VideoReading,
): ReelCard {
  /**
   * A watched reel earns its own bullets plus the one measured line about its
   * opening. A caption reading (or no reading) keeps the arithmetic bullets the
   * page has always used, and the basis line on the card tells the truth.
   */
  if (reading?.basis === "video") {
    const hook = hookLine(reading);
    return {
      url: reel.url,
      views: reel.views,
      likes: reel.likes ?? null,
      comments: reel.comments ?? null,
      why: [
        ...(hook ? [hook] : []),
        ...reading.why.map((line) => plain(line)),
      ],
      basis: "video",
    };
  }

  return {
    url: reel.url,
    views: reel.views,
    likes: reel.likes ?? null,
    comments: reel.comments ?? null,
    why: whyBullets(
      reel,
      usualViews,
      avgLikeShare,
      avgCommentShare,
      own,
      weakest,
    ),
    basis: "captions",
  };
}

/**
 * The disjoint winners/flops split, before it is turned into cards.
 *
 * Exported because the video reader must watch exactly the reels the page will
 * show — the same top three and bottom three, never a fifth opinion about which
 * reels matter. With two to five reels the lists shrink around the middle,
 * winners keeping the odd reel, and no reel ever appears on both sides. With
 * fewer than two reels both lists are empty.
 */
export function splitPlanReels(reels: PlanReel[]): {
  winners: PlanReel[];
  flops: PlanReel[];
} {
  const byViews = [...reels].sort((a, b) => b.views - a.views);
  const n = byViews.length;

  if (n < 2) return { winners: [], flops: [] };

  if (n >= 6) {
    return {
      winners: byViews.slice(0, 3),
      flops: byViews.slice(n - 3).reverse(), // worst first
    };
  }

  const half = Math.ceil(n / 2);
  return {
    winners: byViews.slice(0, half),
    flops: byViews.slice(half).reverse(),
  };
}

/** The reels a profile read should watch: the same ones the cards will show. */
export function reelsToRead(plan: GrowthPlan): ReelToRead[] {
  const { winners, flops } = splitPlanReels(reelsFromPlan(plan));
  return [...winners, ...flops].map((reel) => ({
    url: reel.url,
    shortcode: shortcodeFromUrl(reel.url),
    mediaUrl: reel.mediaUrl,
    caption: reel.caption ?? "",
  }));
}

function splitReels(
  reels: PlanReel[],
  usualViews: number,
  avgLikeShare: number,
  avgCommentShare: number,
  own: boolean,
  readings?: Map<string, VideoReading>,
): { winners: ReelCard[]; flops: ReelCard[] } {
  const { winners, flops } = splitPlanReels(reels);

  return {
    winners: winners.map((r) =>
      toReelCard(
        r,
        usualViews,
        avgLikeShare,
        avgCommentShare,
        own,
        false,
        readings?.get(r.url),
      ),
    ),
    flops: flops.map((r) =>
      toReelCard(
        r,
        usualViews,
        avgLikeShare,
        avgCommentShare,
        own,
        true,
        readings?.get(r.url),
      ),
    ),
  };
}

function computeVitals(
  plan: GrowthPlan,
  reels: PlanReel[],
  authenticity?: ProfileBotEstimate | null,
): ProfileVitals {
  let likes = 0;
  let comments = 0;
  let viewsForLikes = 0;
  let viewsForComments = 0;
  let likesReels = 0;
  let commentReels = 0;

  for (const r of reels) {
    if (r.views > 0 && r.likes !== undefined) {
      likes += r.likes;
      viewsForLikes += r.views;
      likesReels += 1;
    }
    if (r.views > 0 && r.comments !== undefined) {
      comments += r.comments;
      viewsForComments += r.views;
      commentReels += 1;
    }
  }

  return {
    followers: plan.account?.followers ?? plan.standing?.followers,
    likesRatio: likesReels ? ROUND(likes / viewsForLikes) : null,
    avgLikes: likesReels ? Math.round(likes / likesReels) : null,
    commentRatio: commentReels ? ROUND(comments / viewsForComments) : null,
    avgComments: commentReels ? Math.round(comments / commentReels) : null,
    reelsRead: reels.length,
    botToReal: authenticity ?? null,
  };
}

const MOOD_LABEL: Record<string, string> = {
  question: "asking questions",
  objection: "pushing back",
  request: "asking for more",
  story: "telling stories",
};

function buildCommentIntel(plan: GrowthPlan): CommentIntel | null {
  const comments = plan.comments;
  if (!comments || !(comments.read > 0)) return null;

  const seeds = comments.seeds ?? [];
  const total = seeds.reduce((sum, s) => sum + s.asked, 0);

  const mood: CommentIntel["mood"] = [];
  if (total > 0) {
    const byKind = new Map<string, number>();
    for (const s of seeds) {
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.asked);
    }
    mood.push(
      ...[...byKind.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([kind, n]) => ({
          label: plain(MOOD_LABEL[kind] ?? kind),
          pct: ROUND(n / total),
        })),
    );
  } else {
    // No per-seed counts: fall back to a coarse split from the raw buckets.
    const buckets: { label: string; n: number }[] = [
      { label: "asking for more", n: (comments.requests ?? []).length },
      { label: "asking questions", n: (comments.questions ?? []).length },
      { label: "pushing back", n: (comments.objections ?? []).length },
      { label: "praising", n: (comments.praise ?? []).length },
    ].filter((b) => b.n > 0);
    const sum = buckets.reduce((s, b) => s + b.n, 0);
    if (sum > 0) {
      for (const b of buckets) {
        mood.push({ label: plain(b.label), pct: ROUND(b.n / sum) });
      }
    }
  }

  const requests = seeds
    .filter((s) => s.kind === "request" && s.asked > 0)
    .sort((a, b) => b.asked - a.asked)
    .slice(0, 3)
    .map((s) => ({ text: plain(s.text), mentions: s.asked }));

  return { mood, requests };
}

/**
 * The creator-facing summary.
 *
 * It describes the creator — their bio, the plan's reading of what they post,
 * what the audience says and their usual reach — in third person. Cohort
 * quality, search caveats and benchmark language belong in the vitals footnote
 * (`buildComparison`), never in the sentence a stranger reads first.
 */
function buildSummary(plan: GrowthPlan, reels: PlanReel[]): string {
  const parts: string[] = [];

  if (plan.archetype?.blurb) {
    parts.push(neutralisePerson(plain(plan.archetype.blurb)));
  }

  const bio = plan.account?.bio?.trim();
  if (bio) {
    const quoted = bio.length > 220 ? `${bio.slice(0, 217)}…` : bio;
    parts.push(`Their bio reads: “${plain(quoted)}”.`);
  } else if (!parts.length) {
    parts.push(
      `They post ${plain(plan.niche || "Instagram")} content on Instagram.`,
    );
  }

  const topRequest = (plan.comments?.seeds ?? [])
    .filter((seed) => seed.kind === "request" && seed.asked > 0)
    .sort((a, b) => b.asked - a.asked)[0];
  if (topRequest) {
    parts.push(
      `Viewers keep asking for “${plain(topRequest.text)}” (${topRequest.asked} ${
        topRequest.asked === 1 ? "mention" : "mentions"
      }).`,
    );
  } else if (plan.comments?.language?.length) {
    parts.push(
      `The audience keeps repeating: ${plan.comments.language
        .slice(0, 4)
        .map((word) => plain(word))
        .join(", ")}.`,
    );
  }

  if (reels.length) {
    const usual = plan.standing?.medianViews ?? median(reels.map((r) => r.views));
    if (usual > 0) {
      parts.push(
        `Their usual post reaches about ${compact(usual)} views across the ${reels.length} recent ${
          reels.length === 1 ? "reel" : "reels"
        } read.`,
      );
    }
  }

  return parts.join(" ").trim();
}

/**
 * The cohort footnote for section 01.
 *
 * `cohort.basis` is written next to the evidence and already says whether the
 * comparison is size-matched, a whole room, or too thin to call a cohort. It is
 * shown only when there is a real cohort and a sentence to show.
 */
function buildComparison(plan: GrowthPlan): string | undefined {
  const accounts = plan.cohort?.accounts ?? 0;
  const basis = plan.cohort?.basis?.trim();
  if (!basis || accounts <= 0) return undefined;
  return `Compared with ${accounts} ${accounts === 1 ? "account" : "accounts"}: ${sentenceCase(
    basis.replace(/[.]+$/, ""),
  )}.`;
}

function buildAudienceSignals(plan: GrowthPlan): string[] {
  const out: string[] = [];
  const comments = plan.comments;

  const wanted = plan.language?.wanted
    ? languageName(plan.language.wanted)
    : plan.language?.word;
  if (wanted) out.push(`The account works in ${plain(wanted)}.`);

  const words = (comments?.language ?? []).filter(Boolean).slice(0, 4);
  if (words.length) {
    out.push(`The words the audience repeats: ${words.map((w) => plain(w)).join(", ")}.`);
  }

  const requests = (comments?.seeds ?? [])
    .filter((s) => s.kind === "request")
    .sort((a, b) => b.asked - a.asked)
    .slice(0, 3);
  for (const request of requests) {
    out.push(
      `They asked for “${plain(request.text)}” (${request.asked} ${
        request.asked === 1 ? "mention" : "mentions"
      }).`,
    );
  }

  if (!requests.length && comments?.praise?.length) {
    out.push(`The comments were praise, not requests: “${plain(comments.praise[0])}”.`);
  }

  if (!out.length) {
    out.push("No comment threads were read for this account.");
  }

  return [...new Set(out)];
}

/** The multiple written at the start of a peer metric, e.g. "2.4x ..." -> 2.4. */
function metricMultiple(metric: string): number | null {
  const match = metric.trim().match(/^([\d.]+)x\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * The competitor ideas.
 *
 * Instagram-only. A `PlanCompetitor` must carry `platform: "instagram"`; a
 * legacy entry with no platform is treated as not-Instagram, because we cannot
 * prove it was measured on the network this page is about. A reel that did
 * worse than its own usual is not an idea worth scripting, so a metric that
 * says so is left out too.
 */
function buildIdeas(plan: GrowthPlan, ownView: boolean): ProfileIdea[] {
  const raw: PlanCompetitor[] = [];
  const seen = new Set<string>();
  const own = plan.handle.replace(/^@/, "").toLowerCase();

  const add = (idea: PlanCompetitor) => {
    if (idea.platform !== "instagram") return;
    const handle = idea.handle.replace(/^@/, "");
    if (!handle || handle.toLowerCase() === own) return;
    if (!idea.url || seen.has(idea.url)) return;
    const multiple = idea.reasons
      .map((reason) => metricMultiple(reason))
      .find((value): value is number => value !== undefined);
    if (multiple !== undefined && multiple < 1) return;
    seen.add(idea.url);
    raw.push({ ...idea, handle });
  };

  for (const idea of plan.competitors ?? []) add(idea);

  return raw.slice(0, 3).map((idea, index) => ({
    fromHandle: plain(idea.handle),
    platform: "instagram",
    theirViews: idea.views > 0 ? `${compact(idea.views)} views` : "views unknown",
    whyChosen: idea.reasons.map((r) =>
      ownView ? plain(r) : neutralisePerson(plain(r)),
    ),
    concept: plain(idea.caption),
    scriptHref: `/chat?action=script&idea=${index + 1}&handle=${encodeURIComponent(
      plan.handle,
    )}`,
  }));
}

/**
 * Turn a plan into the six-section profile view.
 *
 * `opts.own` adds the next-move card (the owner's own plan). The DNA summary is
 * third person for both views; cohort quality lives in `comparison`, under the
 * vitals, rather than in the creator summary.
 *
 * `opts.authenticity` is the follower-sample estimate, when one was bought;
 * `opts.readings` are the video readings for the reels the page will show.
 * Both are optional and neither can make the view lie: absent is "not read",
 * and a card whose reel was not watched keeps its caption basis.
 */
export function buildProfileView(
  plan: GrowthPlan,
  opts: {
    own: boolean;
    authenticity?: ProfileBotEstimate | null;
    readings?: Map<string, VideoReading>;
  },
): ProfileView {
  const reels = reelsFromPlan(plan);
  const usualViews =
    plan.standing?.medianViews && plan.standing.medianViews > 0
      ? plan.standing.medianViews
      : median(reels.map((r) => r.views));
  const likesReels = reels.filter(
    (r) => r.views > 0 && r.likes !== undefined,
  );
  const commentReels = reels.filter(
    (r) => r.views > 0 && r.comments !== undefined,
  );
  const avgLikeShare = likesReels.length
    ? likesReels.reduce((s, r) => s + (r.likes ?? 0) / r.views, 0) /
      likesReels.length
    : 0;
  const avgCommentShare = commentReels.length
    ? commentReels.reduce((s, r) => s + (r.comments ?? 0) / r.views, 0) /
      commentReels.length
    : 0;

  const { winners, flops } = splitReels(
    reels,
    usualViews,
    avgLikeShare,
    avgCommentShare,
    opts.own,
    opts.readings,
  );

  const view: ProfileView = {
    handle: plan.handle,
    niche: plain(plan.niche ?? ""),
    nicheVerified: nicheIsVerified(plan.nicheFit?.verdict),
    vitals: computeVitals(plan, reels, opts.authenticity),
    dna: {
      summary: buildSummary(plan, reels),
      audienceSignals: buildAudienceSignals(plan),
    },
    winners,
    flops,
    commentIntel: buildCommentIntel(plan),
    ideas: buildIdeas(plan, opts.own),
    comparison: buildComparison(plan),
    own: opts.own,
  };

  if (opts.own && plan.nextMove) {
    view.nextMove = {
      title: plain(plan.nextMove.title),
      why: plain(plan.nextMove.why),
      action: plain(plan.nextMove.action),
      stop: plan.nextMove.stop ? plain(plan.nextMove.stop) : undefined,
    };
  }

  return view;
}

function isInstagramUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/**
 * The one Instagram-only guarantee, enforced at the store boundary.
 *
 * A profile view must never carry a YouTube/TikTok reel or competitor. The
 * builder filters competitors by their evidence platform, but a stored view is
 * a file that can be hand-edited or written by an older build, so `saveProfileView`
 * calls this before anything reaches disk. Reel links must be instagram.com
 * URLs; every idea must be marked Instagram.
 */
export function assertInstagramOnly(view: ProfileView): void {
  for (const card of [...view.winners, ...view.flops]) {
    if (!isInstagramUrl(card.url)) {
      throw new Error(`profile reel is not an Instagram URL: ${card.url}`);
    }
  }
  for (const idea of view.ideas) {
    if (idea.platform !== "instagram") {
      throw new Error(`profile idea is not Instagram: @${idea.fromHandle}`);
    }
  }
}
