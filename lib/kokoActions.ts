/**
 * Koko's one-tap actions.
 *
 * The catalogue is presentation data: the studio renders one button per entry.
 * The prompt builders live here too, but they only ever read stored data — the
 * account's saved plan or a stored profile view — never text supplied by the
 * browser. That is the whole point of a one-tap action: the creator taps it, the
 * server decides what to ask from what it already holds.
 *
 * `deep-spy` and `rate-card` are not model calls. They return a link:
 * a competitor profile is read through the existing paid gate, and the rate card
 * is still locked behind the waitlist.
 */
import { normalizeHandle } from "./handle";
import type { ProfileView } from "./profileView";
import type { GrowthPlan, RawReel } from "./types";

export type KokoActionId =
  | "scripts-from-comments"
  | "deep-spy"
  | "rate-card"
  | "rewrite-flop-hooks"
  /** Opened by the profile page's "Script this (1💎)" link, not a row button. */
  | "script";

export interface KokoAction {
  id: KokoActionId;
  label: string;
  cost: 1;
  locked?: true;
}

/** The founder's order: the three working actions with the locked one between. */
export const KOKO_ACTIONS: readonly KokoAction[] = [
  {
    id: "scripts-from-comments",
    label: "Write 3 Scripts from My Comments",
    cost: 1,
  },
  { id: "deep-spy", label: "Deep-Spy on a Competitor", cost: 1 },
  {
    id: "rate-card",
    label: "Calculate My Brand Deal Rate Card",
    cost: 1,
    locked: true,
  },
  { id: "rewrite-flop-hooks", label: "Rewrite My Flop Reel Hooks", cost: 1 },
];

export const ACTION_LABELS: Record<KokoActionId, string> = {
  "scripts-from-comments": "Write 3 Scripts from My Comments",
  "deep-spy": "Deep-Spy on a Competitor",
  "rate-card": "Calculate My Brand Deal Rate Card",
  "rewrite-flop-hooks": "Rewrite My Flop Reel Hooks",
  script: "Script this idea",
};

/** No comments were read: say so, and charge nothing. */
export const NO_COMMENTS_REPLY =
  "I need comments from your account first. Analyse your handle to unlock this.";

/** No reels were read: same treatment, different sentence. */
export const NO_REELS_REPLY =
  "I need your reels read first. Analyse your handle to unlock this.";

/** The script link named an idea the stored profile does not have. */
export const SCRIPT_MISSING_REPLY =
  "I could not find that idea in the stored profile. Open the profile and pick an idea again.";

/** The locked feature opens the waitlist, never a spend. */
export const RATE_CARD_LOCKED_REPLY =
  "The rate card is locked while we finish it. Join the waitlist and you will be first to know.";

/** Deep-spy needs a handle to open. */
export const DEEP_SPY_NEEDS_HANDLE_REPLY =
  "Tell me which competitor to open and I will take you to their profile.";

/** Only used if a caller reaches the builder with an action it did not check. */
const NO_PLAN_FALLBACK =
  "I could not work out that action. Ask me in your own words instead.";

export interface KokoActionContext {
  /** The signed-in viewer's saved plan, when there is one. */
  plan?: GrowthPlan | null;
  /** The stored, vendor-free profile view for a script link. */
  profile?: ProfileView | null;
  /** 1-based idea index from `?action=script&idea=<n>`. */
  idea?: number;
  /** The competitor handle for deep-spy. */
  competitor?: string | null;
}

export type KokoActionOutcome =
  | {
      kind: "prompt";
      label: string;
      prompt: string;
      /** Stranger text that must ride inside the request's untrusted block. */
      extraUntrusted: string[];
      maxTokens: number;
    }
  | { kind: "free"; reply: string }
  | { kind: "link"; reply: string; href: string };

export function isKokoAction(value: string): value is KokoActionId {
  return (
    value === "scripts-from-comments" ||
    value === "deep-spy" ||
    value === "rate-card" ||
    value === "rewrite-flop-hooks" ||
    value === "script"
  );
}

function commentRequests(plan: GrowthPlan | null | undefined): string[] {
  const comments = plan?.comments;
  if (!comments || !(comments.read > 0)) return [];

  const seeds = (comments.seeds ?? [])
    .filter((seed) => seed.kind === "request" && seed.text.trim())
    .sort((a, b) => b.asked - a.asked)
    .slice(0, 3)
    .map((seed) => seed.text.trim());
  if (seeds.length) return seeds;

  return (comments.requests ?? [])
    .filter((text) => text.trim())
    .slice(0, 3)
    .map((text) => text.trim());
}

function worstReels(plan: GrowthPlan | null | undefined): RawReel[] {
  const withCaptions = (plan?.reels ?? []).filter(
    (reel) => reel.caption.trim() && reel.views > 0,
  );
  if (withCaptions.length) {
    return [...withCaptions]
      .sort((a, b) => a.views - b.views)
      .slice(0, 3);
  }
  const worst = plan?.audit?.worst;
  if (worst?.caption?.trim()) {
    return [
      {
        id: "audit-worst",
        platform: "instagram",
        account: plan?.handle ?? "unknown",
        url: worst.url,
        caption: worst.caption,
        postedAt: plan?.generatedAt ?? new Date(0).toISOString(),
        views: worst.views,
        likes: 0,
        comments: 0,
      },
    ];
  }
  return [];
}

/**
 * Build the server-side instruction for an action.
 *
 * The returned prompt names only stored facts (counts, handles, the idea text).
 * Anything written by a stranger — a competitor's caption, a viewer's comment —
 * is returned in `extraUntrusted` so `lib/chat` can place it inside the request's
 * random delimiter block rather than in the instruction itself.
 */
export function actionPrompt(
  action: string,
  ctx: KokoActionContext,
): KokoActionOutcome {
  if (action === "rate-card") {
    return { kind: "link", reply: RATE_CARD_LOCKED_REPLY, href: "/#vault" };
  }

  // The client uses a free link for Deep-Spy; this branch exists for API
  // callers and never calls the model.
  if (action === "deep-spy") {
    const competitor = ctx.competitor ? normalizeHandle(ctx.competitor) : null;
    if (!competitor) return { kind: "free", reply: DEEP_SPY_NEEDS_HANDLE_REPLY };
    return {
      kind: "link",
      href: `/profile/${encodeURIComponent(competitor)}`,
      reply:
        `Opening @${competitor}'s profile. Cached profiles open free; a fresh read there ` +
        "costs 6 💎 through the same gate. This one-tap costs nothing.",
    };
  }

  if (action === "scripts-from-comments") {
    const requests = commentRequests(ctx.plan);
    if (!requests.length) return { kind: "free", reply: NO_COMMENTS_REPLY };

    return {
      kind: "prompt",
      label: ACTION_LABELS["scripts-from-comments"],
      maxTokens: 1200,
      prompt:
        "Write 3 shot-by-shot Instagram Reel scripts, one for each viewer request in " +
        "the account context. For each script give: the opening line (first two " +
        "seconds), every shot with what is on screen and what is said, the on-screen " +
        "text, and how it loops. Use only the requests and account context provided; " +
        "do not invent numbers or claims.",
      extraUntrusted: requests.map((text) => `Viewer request: "${text}"`),
    };
  }

  if (action === "rewrite-flop-hooks") {
    const reels = worstReels(ctx.plan);
    if (!reels.length) return { kind: "free", reply: NO_REELS_REPLY };

    return {
      kind: "prompt",
      label: ACTION_LABELS["rewrite-flop-hooks"],
      maxTokens: 900,
      prompt:
        "Rewrite the opening line for each weak reel caption in the account context. " +
        "For each one give the original opening in one line, then three new hooks, " +
        "then one sentence on why the new hook should hold attention. Stay inside " +
        "the account's own subjects and do not invent numbers.",
      extraUntrusted: reels.map(
        (reel) => `Weak reel caption (${reel.views} views): "${reel.caption}"`,
      ),
    };
  }

  if (action === "script") {
    const index = (ctx.idea ?? 0) - 1;
    const idea = index >= 0 ? ctx.profile?.ideas[index] : undefined;
    if (!idea) return { kind: "free", reply: SCRIPT_MISSING_REPLY };

    // A stored handle must still be a handle. If it is not, the idea is not
    // usable and the creator is not charged.
    const fromHandle = normalizeHandle(idea.fromHandle);
    if (!fromHandle) return { kind: "free", reply: SCRIPT_MISSING_REPLY };

    const ownNiche = ctx.plan?.niche?.trim();
    const profileNiche = ctx.profile?.niche?.trim();
    const spaces = [
      profileNiche ? `Profile niche: "${profileNiche}"` : "",
      ownNiche && ownNiche !== profileNiche
        ? `Creator's own niche: "${ownNiche}"`
        : "",
    ].filter(Boolean);

    return {
      kind: "prompt",
      label: `Script idea ${index + 1}`,
      maxTokens: 900,
      prompt: [
        `Write a shot-by-shot Instagram Reel script for idea ${index + 1}, from @${fromHandle}.`,
        "The profile's space and the creator's own space, when known, are in the context.",
        "Use the competitor concept and the reasons it was chosen, both in the account context.",
        "Give the opening line for the first two seconds, every shot with what is on screen and what is said, the on-screen text, and the loop.",
        "Do not invent numbers or claim anything the context does not support.",
      ]
        .filter(Boolean)
        .join(" "),
      extraUntrusted: [
        ...spaces,
        `Competitor idea from @${fromHandle}: "${idea.concept}"`,
        ...idea.whyChosen.map(
          (reason) => `Why @${fromHandle} was chosen: ${reason}`,
        ),
      ],
    };
  }

  // `isKokoAction` rejects this before the route reaches the prompt builder.
  return { kind: "free", reply: NO_PLAN_FALLBACK };
}
