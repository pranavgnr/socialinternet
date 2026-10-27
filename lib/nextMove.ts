import { times } from "./fmt";
import type {
  CommentMining,
  CreatorAudit,
  GrowthPlan,
  NextMove,
  PlanMove,
} from "./types";

/**
 * One instruction, not ten.
 *
 * A list of ten ideas is a menu, and a menu is what a beginner uses to avoid
 * starting. This collapses the whole plan — audit gaps, the playbook's moves,
 * what the audience asked for — into the single thing that is worth doing
 * before Sunday, with the evidence attached so it can be argued with.
 *
 * Order of trust: the creator's own posts beat accounts their size, and both
 * beat anything the niche in general is doing.
 */

const LEVER_ACTION: Record<string, (detail: string) => string> = {
  opening: (d) => `Open your next three posts with ${d}. Same video, different first second — nothing else changes.`,
  length: (d) => `Cut your next post to ${d}. Cut the setup, not the ending.`,
  shape: (d) => `Make your next two posts as ${d}. You have already proven it works for you once.`,
  caption: (d) => `Write the next caption as ${d}, and put the searchable words in the first line.`,
  cadence: () => `Post three times this week — Monday, Wednesday, Friday — even if one is rough.`,
  consistency: () => `Reuse the shape of your best post until it stops working, instead of trying a new one.`,
};

function actionFor(gap: CreatorAudit["gaps"][number]): string {
  const render = LEVER_ACTION[gap.lever];
  if (render) return render(gap.winners);
  return `Do more of what your winners did: ${gap.winners}.`;
}

export interface NextMoveInput {
  plan: Pick<GrowthPlan, "handle" | "moves" | "standing">;
  audit?: CreatorAudit;
  comments?: CommentMining;
  peerMedian?: number;
}

export function buildNextMove({ plan, audit, comments }: NextMoveInput): NextMove {
  const gap = audit?.gaps[0];
  const bestMove: PlanMove | undefined = [...plan.moves].sort((a, b) => a.priority - b.priority)[0];

  /* 1. The account's own evidence, when it is strong enough to stand on. */
  if (audit && gap && gap.support >= 2 && gap.strength >= 0.34) {
    const fromOwn = !bestMove || gap.strength >= 0.5;
    const evidence = [
      {
        handle: plan.handle,
        metric: `${gap.support} of your ${Math.min(3, audit.posts)} best posts share it`,
        url: audit.best.url,
        caption: audit.best.caption,
      },
    ];
    if (bestMove && !fromOwn) {
      return merge(plan, bestMove, audit, comments, "your own posts + accounts your size");
    }
    return {
      title: titleFor(gap.lever),
      why: gap.note,
      action: actionFor(gap),
      stop: stopFor(gap.lever),
      evidence,
      confidence: Math.min(0.9, 0.45 + gap.strength * 0.45),
      basis: "your own posts",
      checkOn: checkFor(gap.lever),
    };
  }

  /* 2. A peer-backed move from the playbook. */
  if (bestMove) {
    return merge(plan, bestMove, audit, comments, audit ? "your own posts + accounts your size" : "accounts your size");
  }

  /* 3. Nothing measured — say so, and give the audit as the task. */
  return {
    title: "Get to five posts before changing anything",
    why: audit
      ? `There are only ${audit.posts} posts to read, and no lever separates them yet. Guessing at an edit with this little evidence is how people change the one thing that was working.`
      : "There is nothing to read yet. Not enough posts, so every recommendation below is about other people.",
    action:
      "Publish five posts this fortnight in the same shape. Then come back — the plan will be about you instead of the niche.",
    evidence: [],
    confidence: 0.4,
    basis: audit ? "your own posts" : "accounts your size",
    checkOn: "After five posts, compare the best and the worst. The difference is your first real answer.",
  };
}

function merge(
  plan: Pick<GrowthPlan, "handle" | "moves">,
  move: PlanMove,
  audit: CreatorAudit | undefined,
  comments: CommentMining | undefined,
  basis: NextMove["basis"],
): NextMove {
  const evidence = [...move.evidence];
  if (audit?.best.url && evidence.length < 2) {
    evidence.push({
      handle: plan.handle,
      metric: `${times(audit.best.multiple)} your usual views`,
      url: audit.best.url,
      caption: audit.best.caption,
    });
  }
  const asked = comments?.seeds.find((s) => s.kind === "request" || s.kind === "question");
  return {
    title: move.title,
    why: asked
      ? `${move.why} Your audience is already asking: “${asked.text.slice(0, 90)}”.`
      : move.why,
    action: move.action,
    stop: move.id.includes("song") ? undefined : "Starting a new format before this one is repeated three times.",
    evidence,
    confidence: evidence.length >= 2 ? 0.72 : 0.6,
    basis,
    checkOn: "In seven days: did the median of your new posts move? Not the best one — the median.",
  };
}

function titleFor(lever: string): string {
  switch (lever) {
    case "opening":
      return "Fix the first second";
    case "length":
      return "Shorten to the length that already works";
    case "shape":
      return "Repeat the shape that travels for you";
    case "caption":
      return "Rewrite the caption the way your winners did";
    case "cadence":
      return "Post three times this week";
    case "consistency":
      return "Stop changing the format";
    default:
      return "Do more of what worked";
  }
}

function stopFor(lever: string): string | undefined {
  switch (lever) {
    case "opening":
      return "Opening with a greeting, your name, or 'hey guys'.";
    case "shape":
      return "Experimenting with a new format before this one has been posted three times.";
    case "cadence":
      return "Waiting for a post to be good enough to publish.";
    case "caption":
      return "Hashtag walls and 'link in bio' as the whole caption.";
    default:
      return undefined;
  }
}

function checkFor(lever: string): string {
  switch (lever) {
    case "cadence":
      return "In seven days: three posts published, no gaps longer than three days.";
    case "opening":
      return "In seven days: compare the 3-second hold of the new posts against your last three. Views alone will mislead you at this size.";
    default:
      return "In seven days: the median of your last three posts, not the best one.";
  }
}
