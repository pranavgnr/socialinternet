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
import { plain } from "./plain";
import type { GrowthPlan, PlanCompetitor, RawReel } from "./types";

/**
 * Whether the niche label is "verified" — derived from the account's own posts
 * rather than typed by the visitor. `nicheSource` is absent on plans written
 * before provenance existed, which is treated as unverified.
 */
export function nicheIsVerified(source: string | undefined): boolean {
  return source !== undefined && source !== "user";
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
   * The bot-to-real estimate. `null` in this task — the follower sample that
   * produces it ships in Task 7 — and the vitals slab says why instead of
   * showing a made-up percentage.
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
  /** "captions" for now; the video reader (Task 7) adds "video" */
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
  /** display-ready: the competitor's views, or "views unknown" */
  theirViews: string;
  /** why that competitor was chosen */
  whyChosen: string[];
  /** the concept to script (the competitor's caption) */
  concept: string;
  /** /chat?action=script&idea=<index>&handle=<handle> */
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
  own: boolean;
  /** only for the owner's own plan: the single thing to do this week */
  nextMove?: ProfileNextMove;
}

/** A reel as the plan holds it, with the counts it may not have carried. */
interface PlanReel {
  url: string;
  views: number;
  likes?: number;
  comments?: number;
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
      });
    }
    if (plan.audit?.worst) {
      add({
        url: plan.audit.worst.url,
        views: plan.audit.worst.views,
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
): ReelCard {
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
 * Split the reels into disjoint winners and flops.
 *
 * With six or more reels the page shows the strongest three and the weakest
 * three. With two to five the lists shrink around the middle, winners keeping
 * the odd reel, and no reel ever appears on both sides. With fewer than two
 * reels both lists are empty — the page explains rather than guessing.
 */
function splitReels(
  reels: PlanReel[],
  usualViews: number,
  avgLikeShare: number,
  avgCommentShare: number,
  own: boolean,
): { winners: ReelCard[]; flops: ReelCard[] } {
  const byViews = [...reels].sort((a, b) => b.views - a.views);
  const n = byViews.length;

  if (n < 2) return { winners: [], flops: [] };

  let winners: PlanReel[];
  let flops: PlanReel[];
  if (n >= 6) {
    winners = byViews.slice(0, 3);
    flops = byViews.slice(n - 3).reverse(); // worst first
  } else {
    const half = Math.ceil(n / 2);
    winners = byViews.slice(0, half);
    flops = byViews.slice(half).reverse();
  }

  return {
    winners: winners.map((r) =>
      toReelCard(r, usualViews, avgLikeShare, avgCommentShare, own, false),
    ),
    flops: flops.map((r) =>
      toReelCard(r, usualViews, avgLikeShare, avgCommentShare, own, true),
    ),
  };
}

function computeVitals(plan: GrowthPlan, reels: PlanReel[]): ProfileVitals {
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
    botToReal: null,
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

function buildSummary(plan: GrowthPlan, own: boolean, reels: PlanReel[]): string {
  const parts: string[] = [];

  /**
   * The archetype blurb is the plan's generic read of the account ("You post
   * your own days"). It is useful to the owner, who can judge it against their
   * own feed, but it is the weakest sentence to put on someone else's page —
   * especially when the bio says something different. A competitor summary
   * leads with the bio and the measured positioning instead.
   */
  if (own && plan.archetype?.blurb) parts.push(plain(plan.archetype.blurb));

  const bio = plan.account?.bio?.trim();
  if (bio) {
    const quoted = bio.length > 220 ? `${bio.slice(0, 217)}…` : bio;
    parts.push(`Bio: “${plain(quoted)}”.`);
  } else if (!own) {
    parts.push(
      `They post ${plain(plan.niche || "Instagram")} content on Instagram.`,
    );
  }

  const positioning = own
    ? plan.diagnosis
    : (plan.nicheFit?.reasons ?? []).join(" ");
  if (positioning?.trim()) parts.push(plain(positioning));

  if (!parts.length) {
    const niche = plain(plan.niche || "Instagram");
    parts.push(`This account posts ${niche} content on Instagram.`);
  }

  if (reels.length) {
    const usual = plan.standing?.medianViews ?? median(reels.map((r) => r.views));
    if (usual > 0) {
      parts.push(
        `${own ? "Your" : "Their"} usual post reaches about ${compact(usual)} views across the ${reels.length} recent ${
          reels.length === 1 ? "reel" : "reels"
        } read.`,
      );
    }
  }

  return parts.join(" ").trim();
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

/** Views written into a peer metric, e.g. "· 2.4M views" -> 2400000. */
function viewsFromMetric(metric: string): number {
  const match = metric.match(/·\s*([\d.]+)\s*([kKmM]?)\s*views/i);
  if (!match) return 0;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const unit = match[2].toLowerCase();
  if (unit === "m") return Math.round(n * 1_000_000);
  if (unit === "k") return Math.round(n * 1_000);
  return Math.round(n);
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
 * New plans keep a `competitors` array, written where the peer evidence was
 * chosen. Older plans only kept the move list, so the same evidence is read back
 * from it here — never a second vendor pull, and never a competitor we did not
 * actually measure. A reel that did *worse* than its own usual is not an idea
 * worth scripting, so a metric that says so is left out.
 */
function buildIdeas(plan: GrowthPlan, ownView: boolean): ProfileIdea[] {
  const raw: PlanCompetitor[] = [];
  const seen = new Set<string>();
  const own = plan.handle.replace(/^@/, "").toLowerCase();

  const add = (idea: PlanCompetitor) => {
    const handle = idea.handle.replace(/^@/, "");
    if (!handle || handle.toLowerCase() === own) return;
    if (!idea.url || seen.has(idea.url)) return;
    const multiple = idea.reasons
      .map((reason) => metricMultiple(reason))
      .find((value): value is number => value !== null);
    if (multiple !== undefined && multiple < 1) return;
    seen.add(idea.url);
    raw.push({ ...idea, handle });
  };

  for (const idea of plan.competitors ?? []) add(idea);

  if (!raw.length) {
    for (const move of plan.moves ?? []) {
      for (const evidence of move.evidence ?? []) {
        add({
          handle: evidence.handle.replace(/^@/, ""),
          views: viewsFromMetric(evidence.metric),
          url: evidence.url ?? "",
          caption: evidence.caption ?? move.title,
          reasons: [evidence.metric],
        });
      }
    }
  }

  if (!raw.length && plan.nextMove) {
    for (const evidence of plan.nextMove.evidence ?? []) {
      add({
        handle: evidence.handle.replace(/^@/, ""),
        views: viewsFromMetric(evidence.metric),
        url: evidence.url ?? "",
        caption: evidence.caption ?? plan.nextMove.title,
        reasons: [evidence.metric],
      });
    }
  }

  return raw.slice(0, 3).map((idea, index) => ({
    fromHandle: plain(idea.handle),
    theirViews: idea.views > 0 ? `${compact(idea.views)} views` : "views unknown",
    whyChosen: idea.reasons.map((r) =>
      ownView ? plain(r) : neutralisePerson(plain(r)),
    ),
    concept: plain(idea.caption),
    scriptHref: `/chat?action=script&idea=${index}&handle=${encodeURIComponent(
      plan.handle,
    )}`,
  }));
}

/**
 * Turn a plan into the six-section profile view.
 *
 * `opts.own` adds the next-move card (the owner's own plan) and reads the
 * plan's diagnosis for the DNA summary; a competitor view reads the niche-fit
 * reasons instead, because the diagnosis and the move list are owner-addressed
 * and were stripped by `toCompetitorView`.
 */
export function buildProfileView(
  plan: GrowthPlan,
  opts: { own: boolean },
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
  );

  const view: ProfileView = {
    handle: plan.handle,
    niche: plain(plan.niche ?? ""),
    nicheVerified: nicheIsVerified(plan.nicheSource),
    vitals: computeVitals(plan, reels),
    dna: {
      summary: buildSummary(plan, opts.own, reels),
      audienceSignals: buildAudienceSignals(plan),
    },
    winners,
    flops,
    commentIntel: buildCommentIntel(plan),
    ideas: buildIdeas(plan, opts.own),
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
