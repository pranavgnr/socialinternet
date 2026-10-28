import { jsonCall, llmReady } from "./llm";
import { isStopword, looksEnglish } from "./text";
import type {
  FormatContainer,
  HookType,
  PatternCard,
  ScoredSignal,
} from "./types";

const HOOK_WORDS: [HookType, RegExp][] = [
  ["number", /\b\d+\s*(days?|weeks?|months?|hours?|\$|dollars?|k\b|ways?|things?|mistakes?)\b/i],
  ["challenge", /\b(challenge|for a (week|day|month)|i tried|i did .* for)\b/i],
  ["confession", /\b(i (lost|failed|quit|wasted|regret)|confession|honestly|nobody tells)\b/i],
  ["objection", /\b(but |won't work|doesn't work|myth|wrong about|stop believing|actually you can)\b/i],
  ["contrarian", /\b(unpopular|hot take|controversial|stop doing|nobody needs|overrated)\b/i],
  ["reveal", /\b(here'?s (how|why|what)|the truth|secret|revealed|i found)\b/i],
  ["result", /\b(i made|i grew|i earned|went from .* to|results?)\b/i],
  ["question", /\?|\b(why does|how do you|what if)\b/i],
];

const FORMAT_WORDS: [FormatContainer, RegExp][] = [
  ["before_after", /\b(before|after|transformation|glow ?up|then vs now)\b/i],
  ["challenge", /\b(challenge|for \d+ (days?|weeks?)|i tried)\b/i],
  ["comparison", /\b(vs\.?|versus|compared|cheaper than|better than)\b/i],
  ["listicle", /\b\d+ (ways|things|mistakes|tips|reasons|tools)\b/i],
  ["reaction", /\b(reacting|reaction|watching|my face when)\b/i],
  ["pov", /\b(pov|when you|me when)\b/i],
  ["case_study", /\b(i made|results|case study|how i (built|grew|earned))\b/i],
  ["story", /\b(story|one time|last (week|month|year)|so this happened)\b/i],
  ["tutorial", /\b(how to|tutorial|step by step|here'?s how)\b/i],
];

const guessHookType = (text: string): HookType =>
  HOOK_WORDS.find(([, re]) => re.test(text))?.[0] ?? "reveal";

const guessFormat = (text: string): FormatContainer =>
  FORMAT_WORDS.find(([, re]) => re.test(text))?.[0] ?? "story";

/**
 * A topic has to be a short noun phrase, because it gets dropped into hook
 * templates ("3 things about {topic}"). A raw caption clipped to 90 chars
 * produces "3 things about I automated my whole client onboarding…", which
 * reads like a bug. Cut the clause at the first preposition, drop the filler
 * and a leading past-tense verb, and keep the last three content words.
 */
export function topicPhrase(caption: string): string {
  // A caption with no English function word is not a safe source for an English
  // topic slot. Keyword search pulls creators posting in Indonesian, Portuguese
  // and Spanish, and "gratis di github" dropped into a hook template reads as a
  // bug rather than an idea — so fall through to the pillar instead.
  if (!looksEnglish(caption)) return "";
  const clause = caption.replace(/#\S+/g, " ").split(/[.!?\n]/)[0];
  const head = clause.split(
    /\b(?:with|using|that|when|after|before|without|from|for|in|on|to)\b/i,
  )[0];
  // Shared stoplist (text.ts), not a local copy: the local one missed CTAs and
  // filler, which produced topics like "comment tv" and "tutorials something".
  const words = head
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\w.]+/g, " ")
    .toLowerCase()
    // Curly quotes are extremely common in captions; without normalising them
    // "I’ll" splits into "i" + "ll" and "ll" survives as a topic word.
    .replace(/[\u2018\u2019\u02BC\u00B4`]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && /[\p{L}\p{N}]/u.test(w) && !isStopword(w));
  if (words.length > 2 && /ed$/.test(words[0])) words.shift();
  // A single short fragment ("tv", "come", "edit") is not a topic slot filler
  // either. Four letters is the cut-off: "vlog" and "come" describe the act of
  // posting, not a subject, and "Post more come" reads like a bug on the page.
  const phrase = words.slice(-3).join(" ");
  return words.length === 1 && phrase.length < 5 ? "" : phrase;
}

/** Fallback decomposition so the pipeline runs end-to-end without an API key. */
function heuristicPattern(s: ScoredSignal): PatternCard {
  const hook = (s.transcript || s.onScreenText || s.caption || "")
    .split(/[.!?\n]/)[0]
    .trim()
    .slice(0, 140);
  const format = guessFormat(`${s.caption} ${s.transcript ?? ""}`);
  return {
    signalId: s.id,
    hookText: hook || s.caption.slice(0, 120),
    hookType: guessHookType(`${hook} ${s.caption}`),
    format,
    topic: topicPhrase(s.caption),
    tension: "the gap between what the viewer believes and what is true",
    payoff: "a concrete, repeatable way to close that gap",
    cta: s.caption.includes("comment") ? "comment a keyword" : "save this",
    durationSec: 28,
    whyItWorked: `A ${format.replace(/_/g, " ")} post that did ${s.ratio}x its account's usual views, while the idea was still ${s.phase}.`,
    skeleton: `${format} → hook ${guessHookType(hook)} → 3 proof beats → single takeaway`,
  };
}

const SYSTEM = `You decode short-form video outliers into reusable pattern cards.
You are given videos that beat their own account's median views by 3x or more.
For each, extract the STRUCTURE only — never copy the creator's execution.
Return JSON: {"cards":[{ "signalId":string, "hookText":string (the first 3 spoken/on-screen seconds, paraphrased if needed), "hookType":"result|challenge|number|reveal|confession|objection|contrarian|question", "format":"tutorial|challenge|before_after|listicle|story|pov|comparison|reaction|case_study", "topic":string (5 words max), "tension":string (what belief or worry the hook provokes), "payoff":string (what the viewer gets), "cta":string, "durationSec":number, "whyItWorked":string (one plain sentence: how much bigger than usual it did, and whether the idea is still early. No jargon), "skeleton":string (format → hook → beats → payoff, usable by any creator) }]}
Rules: hookType and format must be from the allowed values. No hashtags in topic. Be concrete, not generic.`;

export async function decompose(
  signals: ScoredSignal[],
): Promise<PatternCard[]> {
  if (!signals.length) return [];
  if (!llmReady()) return signals.map(heuristicPattern);

  const out: PatternCard[] = [];
  const batchSize = 8;
  for (let i = 0; i < signals.length; i += batchSize) {
    const batch = signals.slice(i, i + batchSize);
    const payload = batch.map((s) => ({
      signalId: s.id,
      platform: s.platform,
      account: s.account,
      caption: s.caption.slice(0, 400),
      transcript: s.transcript?.slice(0, 1200),
      onScreenText: s.onScreenText?.slice(0, 400),
      ratio: s.ratio,
      phase: s.phase,
      views: s.views,
      baseline: s.baseline,
      engagementRate: s.engagementRate,
    }));
    try {
      const res = await jsonCall<{ cards: PatternCard[] }>(
        SYSTEM,
        JSON.stringify({ videos: payload }),
        { temperature: 0.2 },
      );
      const known = new Set(batch.map((b) => b.id));
      const got = new Set<string>();
      for (const card of res.cards ?? []) {
        if (card?.signalId && known.has(card.signalId)) {
          out.push(card);
          got.add(card.signalId);
        }
      }
      /**
       * A signal the model said nothing about was silently thrown away.
       *
       * Measured on @natgeotravel: a four-signal batch came back with two cards,
       * both from the creator's own posts, and the two cards the week actually
       * needed — @nasa's 11M-view POV and @natgeohistory's pyramid — were never
       * produced. Every idea downstream was then built from the creator's own
       * footage, which is the one thing they cannot learn from.
       *
       * A missing card is the model declining one item, not evidence that the
       * post is uninteresting, so the heuristic stands in. Anything real is
       * better than a hole where another account used to be.
       */
      for (const b of batch) {
        if (!got.has(b.id)) out.push(heuristicPattern(b));
      }
    } catch {
      out.push(...batch.map(heuristicPattern));
    }
  }
  return out;
}
