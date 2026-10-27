import { recommendationFor, type ArchetypeId } from "./archetype";
import {
  formatIdFromLabel,
  videoFormat,
  type VideoFormatId,
} from "./formats";
import { jsonCall, llmReady } from "./llm";
import { lowerFirst } from "./plain";
import { readsLikeSongTitle } from "./songs";
import { hasForeignWords, hasVerbWord, isVerbWord } from "./text";
import type {
  FormatContainer,
  HookType,
  Idea,
  PatternCard,
  Profile,
  Recommendation,
} from "./types";

export type DraftIdea = Pick<
  Idea,
  | "title"
  | "hookVariants"
  | "hookType"
  | "format"
  | "topic"
  | "beats"
  | "shotList"
  | "onScreenText"
  | "sound"
  | "soundWindowDays"
  | "caption"
  | "hashtags"
  | "whyThis"
  | "effort"
> & { pattern: PatternCard };

const SYSTEM = `You are the adaptation engine of a short-form video idea system.
You receive the creator's profile — including the family of advice their account
gets — and pattern cards decoded from reels that beat their own account's usual
views.

Your job is the three translation moves, applied to the creator's own world:
  1. same format, different topic
  2. same topic, the creator's own perspective (their stakes, not the original's)
  3. format from one post + topic from another

The profile's "recommendation" field decides what an idea IS. Follow it exactly:

- "songs": the idea is a performance. Name the exact song from their songs list,
  say which line to start on, use format "performance". Never write a talking-head
  opening for a music account — her first three seconds are already the song.
- "formats": the idea is a VIDEO SHAPE — a day in the life, a routine, a
  come-with-me, a numbered list, a place, a first attempt. Give the shape, the
  moment it opens on, and the scene order. The opening is a moment or a line of
  voiceover, never a talking head delivering a hooky spoken promise.
- "hooks": the first spoken line is the product. Every opening must work in the
  first 3 seconds, be a spoken line (not a title), and contain something specific
  (a number, a constraint, a named fear). No "in this video", no "let's dive in".
- "craft": the visible result leads. Open on the finished thing, then show how it
  was made.
- "none": do not invent a lever for this account. Describe the video plainly from
  the pattern and keep every claim modest.

Hard rules:
- Stay inside the creator's pillars and voice. Respect their constraints.
- Never use their banned words.
- Ideas must be filmable by one person with a phone in the stated setting.
- "hookVariants" always holds three ways to open the first 1-3 seconds, in the
  form the family requires: a song line, an opening moment, a spoken hook, or the
  finished result on screen.

ORIGINALITY CONTRACT — this is the part that matters most.
A pattern card's "hookText" is another creator's actual opening line. It is
evidence, not raw material. You are forbidden from reusing it.

For every idea you must make all four of these moves:
  1. CHANGE THE SUBJECT. The idea is about the creator's own world — their
     subject, their offer, their audience. Not the source creator's subject.
  2. CHANGE THE ANGLE. Do not restate the source's tension. Find a different
     reason the same container works, ideally one the source never mentions.
  3. CHANGE THE SPECIFICS. New number, new name, new constraint, new timeframe.
     Never carry over a figure, a proper noun, a brand, a place, or a product
     that appears in hookText or skeleton.
  4. ANCHOR IT. Every idea must contain at least one detail that could only
     have come from THIS creator's profile: one of their ownWinners, one of
     their audienceQuestions, one of their pillars, their offer, or their
     stated constraint. Say that detail out loud in a beat or a shot.

Banned moves, all of which count as a failed idea:
- Reusing the source's sentence shape: same opening word, same rhythm, same
  "X then Y" or "I did X for N days" frame with new nouns dropped in.
- Swapping a synonym and calling it new ("AI agents" -> "automations").
- Writing the generic version of the topic with no creator-specific detail.
- Mentioning the source creator, their account, their video, or their numbers.

The test each idea must pass: if the source creator watched it, they could not
recognise their own video in it. Same container, entirely different film.

Return JSON: {"ideas":[{ "title":string, "hookVariants":[3 spoken hook lines], "hookType":"result|challenge|number|reveal|confession|objection|contrarian|question", "format":"tutorial|challenge|before_after|listicle|story|pov|comparison|reaction|case_study", "topic":string, "beats":[5 short script beats], "shotList":[3-6 shots], "onScreenText":[2-4 short overlays], "sound":string (only if a trend matters here, else omit), "soundWindowDays":number, "caption":string (under 125 chars), "hashtags":[3], "whyThis":string (ONE plain sentence a creator understands: what this idea borrows and how well it did. No internal words like outlier, median, cohort, ratio, signal, pattern — say "did 4x their usual views" instead), "effort":"low|medium|high", "patternSignalId":string }]}
COVERAGE — required. Return exactly "ideasPerPattern" ideas for EVERY pattern
card you are given: with 5 cards and ideasPerPattern 2 you return 10 ideas, not
6. Do not skip a card because you liked another one better. Every idea must
carry its card's exact "signalId" in "patternSignalId"; the two ideas from one
card must be different ideas, not two phrasings of the same one. Returning
fewer than required is a failed response.`;

/**
 * The lexical gate in rank.ts can only see shared words, so it cannot tell a
 * subject noun ("claude code") from a stolen framing ("the most boring X I
 * built"). Re-filming the same conceit in new nouns is exactly what the owner
 * asked this system never to ship, and only a semantic read can catch it.
 */
const AUDIT_SYSTEM = `You are a plagiarism auditor for short-form video ideas.

Each pair gives the SOURCE creator's opening line and topic, and a NEW idea's
opening line and topic. Decide whether the new idea is a re-filming of the
source or a genuinely different video that borrows only the container.

Judge the CONCEIT, not the wording. If the two share the same joke, the same
reveal, the same emotional beat or the same adjective+noun framing with new
nouns swapped in, they are the same video.

- "copy": same conceit in new nouns. The source creator would recognise their
  own reel. Synonym swaps, the same "most boring X I built" / "I did X for N
  days" frame with new subjects, or the same reveal in the same order.
- "variant": same container and broadly the same angle, but a different enough
  specific that a viewer would experience a different video.
- "new": different angle, different subject, or a flip the source never made.
  Only the format is shared.

Shared subject vocabulary alone is NOT a copy — two creators in the same niche
naturally use the same nouns. What counts is the framing.

Be strict. When the openings share their main conceit, say "copy".

Return JSON: {"verdicts":[{"i":number,"verdict":"new|variant|copy","why":"one short clause"}]}
Judge every pair you are given.`;

const ROTATION: HookType[] = [
  "result",
  "contrarian",
  "confession",
  "number",
  "objection",
  "challenge",
  "reveal",
  "question",
];

/** Word-boundary truncation — slicing at 72 chars cuts titles mid-word. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  // Cutting at a space frequently lands right after a comma or dash, which then
  // reads as "…workflow,…". Strip trailing punctuation before the ellipsis.
  const body = (space > max * 0.6 ? cut.slice(0, space) : cut)
    .replace(/[\s,;:—–-]+$/u, "")
    .trim();
  return `${body}…`;
}

/**
 * Titles come from the hook, but a hook can run to two sentences. Cutting that
 * at 72 chars left dangling tails ("There's one…"), so prefer the first
 * complete sentence when it stands on its own as a title.
 */
function titleFrom(hook: string): string {
  const cleaned = hook.replace(/\s+/g, " ").trim();
  // A hook that already fits is a complete thought — keep it whole, punctuation
  // and all. Cutting it to the first sentence dropped the payoff.
  if (cleaned.length <= 72) return cleaned;
  const first = cleaned.split(/(?<=[.?!])\s+/)[0];
  // Only fall back to the first sentence if it is a usable title on its own.
  if (first.length >= 24 && first.length <= 72) return first;
  return truncate(cleaned.replace(/\.$/, ""), 72);
}

function mockHooks(
  topic: string,
  hookType: HookType,
  pillar: string,
  variant = 0,
  salt = 0,
): { hookType: HookType; hooks: string[] } {
  const t = topic || pillar;
  // Second and third ideas from the same card must not reuse the same hook type,
  // or the feed fills up with near-identical lines.
  // First idea keeps the decoded hook type (that is the evidence). Later ideas
  // rotate with a per-card salt, so the feed does not become ten reveals.
  const type =
    variant === 0
      ? hookType
      : ROTATION[
          (Math.max(0, ROTATION.indexOf(hookType)) + variant + salt) %
            ROTATION.length
        ];
  // Every line below puts the topic in a slot that tolerates both singular and
  // plural noun phrases ("automation walkthrough" and "client systems" both
  // read). Earlier versions embedded it mid-clause, which produced lines like
  // "This ai tool teardowns change took 4 minutes".
  const bank: Record<HookType, string[]> = {
    result: [
      `Spent 30 days on ${t}. One change moved the number.`,
      `One change to ${t} did more than a month of posting.`,
      `Tracked every day of ${t}. Here's the honest scoreboard.`,
    ],
    number: [
      `3 things about ${t} nobody tells you until month six.`,
      `$0 spent, 11 posts, one system for ${t}. Here's the breakdown.`,
      `7 mistakes I made with ${t} before it clicked.`,
    ],
    contrarian: [
      `Everyone says ${t} is the shortcut. It's the opposite.`,
      `Stop optimising ${t}. Do this instead, once.`,
      `Hot take: most ${t} advice comes from people who never shipped it.`,
    ],
    confession: [
      `I wasted 3 months on ${t} before admitting I was wrong.`,
      `I quit ${t} for a week. It went better than the month before.`,
      `Nobody warns you what ${t} actually costs.`,
    ],
    objection: [
      `"I don't have time for ${t}" — you do. It's 11 minutes a week.`,
      `"${t} doesn't work in my niche" — it did here, in 3 posts.`,
      `You're not bad at ${t}. You're doing the second step first.`,
    ],
    challenge: [
      `I tried ${t} for 7 days, one input a day. Day 4 changed it.`,
      `7 days, no scroll, only ${t}. Here's what broke first.`,
      `I gave myself one rule for ${t} and broke it twice.`,
    ],
    reveal: [
      `Why ${t} keeps flattening after post 3 — and the fix.`,
      `The one thing every big account does with ${t}, never explained.`,
      `The real reason ${t} feels harder than it looks.`,
    ],
    question: [
      `Why does ${t} work for everyone except you? There's one variable.`,
      `What if ${t} isn't the problem — the order is?`,
      `How do you know ${t} is working before the numbers do?`,
    ],
  };
  const lines = bank[type] ?? bank.reveal;
  const off = variant % lines.length;
  return {
    hookType: type,
    hooks: [...lines.slice(off), ...lines.slice(0, off)].map(polish),
  };
}

/** Lowercase topics read as machine output without this ("ai tool" → "AI tool"). */
const ACRONYMS = new Map(
  Object.entries({
    ai: "AI", n8n: "n8n", api: "API", apis: "APIs", sop: "SOP", sops: "SOPs",
    crm: "CRM", seo: "SEO", llm: "LLM", llms: "LLMs", ui: "UI", ux: "UX",
    pdf: "PDF", dm: "DM", dms: "DMs", gpt: "GPT", mcp: "MCP", roi: "ROI",
  }),
);

/** Brand names of any length — the acronym map below only matches 2-4 letters. */
const PROPER = new Map(
  Object.entries({
    claude: "Claude", chatgpt: "ChatGPT", openai: "OpenAI", anthropic: "Anthropic",
    instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", github: "GitHub",
    notion: "Notion", zapier: "Zapier", cursor: "Cursor", gemini: "Gemini",
    deepseek: "DeepSeek", figma: "Figma", canva: "Canva", airtable: "Airtable",
  }),
);

function polish(s: string): string {
  const out = s.replace(/\b[a-z0-9][a-z0-9'-]*\b/gi, (w) => {
    const k = w.toLowerCase();
    return PROPER.get(k) ?? ACRONYMS.get(k) ?? w;
  });
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Pillars are written as plurals ("automation walkthroughs"), which break the
 * singular slots in the hook bank. Naive de-pluralisation is enough here.
 */
function singularize(phrase: string): string {
  // Only simple noun phrases can be de-pluralised safely. "build in public
  // numbers" and "client systems and SOPs" are compounds, and stripping the
  // final "s" produced "build in public number" — broken in every hook slot.
  if (/\b(and|in|of|for|with|to|vs)\b/i.test(phrase)) return phrase;
  const words = phrase.trim().split(/\s+/);
  const i = words.length - 1;
  const w = words[i] ?? "";
  if (/(ses|xes|ches|shes)$/i.test(w)) words[i] = w.replace(/es$/i, "");
  else if (/ies$/i.test(w)) words[i] = w.replace(/ies$/i, "y");
  else if (/[a-z]s$/i.test(w) && !/(ss|us|is)$/i.test(w))
    words[i] = w.replace(/s$/i, "");
  return words.join(" ");
}

/**
 * Guard rail for template-based hooks: a topic longer than three words, or one
 * that opens with sentence scaffolding, produces broken grammar
 * ("3 things about I automated my whole…"). Fall back to a pillar instead.
 */
function safeTopic(raw: string, fallback: string): string {
  if (!raw || /^untitled$/i.test(raw.trim())) return fallback;
  const t = raw
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Belt and braces: a phrase like "automatically aa jayega" can reach this
  // slot from a caption the language gate judged acceptable.
  if (hasForeignWords(t)) return fallback;
  // Strip verb scaffolding from both ends ("built lead-scoring bot" →
  // "lead-scoring bot", "skill file used" → "skill file"). One shared verb set
  // rather than two hand-written lists, which kept missing forms like "seen".
  const words = t.split(" ").filter(Boolean);
  while (words.length > 2 && isVerbWord(words[0])) words.shift();
  while (words.length > 1 && isVerbWord(words[words.length - 1])) words.pop();
  // A verb still in the middle means this is a clause, not a topic
  // ("seen need bmw", "claude got"). Fall back to the pillar.
  const cleaned = words.join(" ");
  if (!words.length || words.length > 3 || hasVerbWord(cleaned)) return fallback;
  if (
    /^(i|we|you|they|nobody|everyone|heres?|this|that|when|why|how)\b/i.test(
      cleaned,
    )
  )
    return fallback;
  return cleaned.toLowerCase();
}

function mockDraft(
  profile: Profile,
  pattern: PatternCard,
  pivot: string,
  variant = 0,
  salt = 0,
): DraftIdea {
  // Rotate the fallback pillar per card. Every pattern whose caption yields no
  // usable topic previously fell back to pillars[0], which made 7 of 10 ideas
  // the same topic — the opposite of the pillar rotation the research calls for.
  const pillarList = profile.pillars.length ? profile.pillars : [profile.niche];
  const pillar = singularize(
    pillarList[Math.abs(salt) % pillarList.length] ?? profile.niche,
  );
  const topic = safeTopic(pivot || pattern.topic, pillar);
  const { hookType, hooks } = mockHooks(
    topic,
    pattern.hookType,
    pillar || topic,
    variant,
    salt,
  );
  // The hook IS the idea, so use it as the title — a bare label like
  // "topic — format using a hook" tells the creator nothing at a glance.
  const title = titleFrom(hooks[0]);
  return {
    title,
    hookVariants: hooks,
    hookType,
    format: pattern.format,
    // Same acronym casing as the hooks, so the topic label and the title agree
    // ("AI tool teardowns", not "ai tool teardowns" beside "AI tool teardowns").
    topic: polish(topic),
    beats: [
      `Hook: ${hooks[0]}`,
      `Context in one line — who this is for and the stake.`,
      `Proof beat 1: the specific thing you did (numbers, dates).`,
      `Proof beat 2: the part that went wrong, and the fix.`,
      `Payoff: the one takeaway they can copy today. ${pattern.cta}`,
    ],
    shotList: [
      "Talking head, chest up, natural light",
      "Screen recording of the actual thing you're describing",
      "Before/after overlay, 2 seconds",
      "Close-up on the number or the result",
    ],
    onScreenText: [
      truncate(hooks[0], 42),
      "the part nobody mentions",
      "save this for later",
    ],
    sound: undefined,
    soundWindowDays: undefined,
    caption: `${truncate(hooks[0], 90)} ${profile.offer ? `→ ${profile.offer}` : ""}`.trim(),
    hashtags: profile.pillars.slice(0, 3).map((p) => `#${p.replace(/\s+/g, "")}`),
    whyThis: `This ${pattern.format.replace(/_/g, " ")} format did several times its account's usual views; your angle is ${topic}.`,
    effort: "low",
    pattern,
  };
}

/**
 * A cover idea, built around the song rather than around a spoken opening.
 *
 * This is the whole point of detecting the account type first: "open with a flat
 * statement" is meaningless advice for someone whose first three seconds are
 * already the song. What she can actually act on is which song, which line to
 * start on, and how to hold the take.
 */
function musicDraft(
  profile: Profile,
  pattern: PatternCard,
  song: string,
  index: number,
): DraftIdea {
  const hooks = [
    `“${song}” — the part everyone waits for`,
    `Singing “${song}” the way it deserves`,
    `If you know “${song}”, you already know what's coming`,
  ];
  const caption = `“${song}” 🎙️ ${
    index % 2 ? "Which song next?" : "Full version on my page."
  }`.slice(0, 120);

  return {
    title: `Cover “${song}”`,
    hookVariants: hooks,
    hookType: "reveal",
    format: "performance",
    topic: song,
    beats: [
      "Song title and your handle on screen in the first second.",
      "Start on the line people already know — the chorus or the hook line. No spoken intro.",
      "One continuous take. No cuts for the first 15 seconds.",
      "Lift on the payoff line: step closer to the phone, add nothing else.",
      "End on the line that makes them replay it, then cut — no sign-off.",
    ],
    shotList: [
      "Phone at chest height, face in the top third of the frame",
      "One room, one light source in front of you",
      "Same framing throughout — the lift comes from the voice, not the camera",
      "Hold for a beat after the last line, then cut",
    ],
    onScreenText: [song, "full version on my page", "which song next?"],
    sound: song,
    soundWindowDays: 14,
    caption,
    hashtags: (profile.pillars ?? []).slice(0, 3).map((p) => `#${p.replace(/\s+/g, "")}`),
    whyThis: `“${song}” is one of the songs breaking out for accounts your size right now. This is your take on it, not a copy of theirs.`,
    effort: "low",
    pattern,
  };
}

/**
 * The idea feed for a music account: one cover per song the plan identified.
 * A singer with ten cover ideas and no songs named has been given nothing.
 */
export function musicDrafts(profile: Profile, patterns: PatternCard[]): DraftIdea[] {
  /**
   * The plan's song list can be older than the extractor. Anything in it that no
   * longer reads like a title is dropped here rather than printed in quotation
   * marks as a song to cover — "Cover “ending is hilaaaarious”" is the single
   * most damaging line this product could show a singer.
   */
  const songs = (profile.songs ?? [])
    .filter(Boolean)
    .filter((s) => readsLikeSongTitle(s))
    .filter((s, i, all) => all.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, 8);
  return songs.map((song, i) =>
    musicDraft(profile, patterns[i % patterns.length], song, i),
  );
}

/* ------------------------------------------------------------------ *
 * Video shapes: the feed for accounts whose lever is the video itself
 * ------------------------------------------------------------------ */

/** Old pattern formats → a catalogued shape, for when a plan named none. */
const CONTAINER_SHAPE: Partial<Record<FormatContainer, VideoFormatId>> = {
  tutorial: "how_to",
  challenge: "first_time",
  before_after: "before_after",
  listicle: "numbered_list",
  story: "storytime",
  pov: "pov",
  comparison: "before_after",
  reaction: "first_time",
  case_study: "behind_scenes",
};

/** Catalogued shape → the stored format container, so ranking keeps working. */
const SHAPE_CONTAINER: Record<VideoFormatId, FormatContainer> = {
  day_in_life: "story",
  routine: "story",
  come_with_me: "story",
  numbered_list: "listicle",
  storytime: "story",
  pov: "pov",
  first_time: "challenge",
  behind_scenes: "case_study",
  place_guide: "story",
  before_after: "before_after",
  how_to: "tutorial",
};

/** Which family of advice this creator gets, from the kind of account they are. */
export function familyOf(profile: Profile): Recommendation {
  const id = profile.archetype as ArchetypeId | undefined;
  if (!id) return "none";
  return recommendationFor(id);
}

/**
 * Fill a template slot, then repair the one artifact filling always risks: a
 * topic that already ends in the word the template puts after it. "morning
 * routine" + "My {topic} routine — …" read "My morning routine routine", which
 * is the sort of line that tells a visitor a machine wrote it.
 */
const fill = (template: string, topic: string) =>
  template
    .replace(/\{topic\}/g, topic)
    .replace(/\b(\p{L}{3,})(\s+\1\b)+/giu, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** `#morningroutine` — reach tags built from what the idea is actually about. */
const hashtag = (s: string) =>
  `#${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")}`;

/**
 * Patterns that share a topic produce near-identical video ideas. Distinct
 * subjects go first, so three ideas from one niche are three different videos.
 */
function distinctFirst(patterns: PatternCard[]): PatternCard[] {
  const seen = new Set<string>();
  const first: PatternCard[] = [];
  const rest: PatternCard[] = [];
  for (const p of patterns) {
    const key = (p.topic ?? "").toLowerCase().trim();
    if (key && seen.has(key)) rest.push(p);
    else {
      if (key) seen.add(key);
      first.push(p);
    }
  }
  return [...first, ...rest];
}

/**
 * A video idea for an account whose lever is the shape of the video.
 *
 * There is no hook bank here on purpose. A vlogger's first second is a moment —
 * a door closing, a result already on screen, the thing going wrong — and
 * handing them three spoken one-liners is how the feed used to read like advice
 * written for a business coach.
 */
function formatDraft(
  profile: Profile,
  pattern: PatternCard,
  shapeId: VideoFormatId,
  index: number,
): DraftIdea {
  const shape = videoFormat(shapeId);
  const pillarList = profile.pillars.length ? profile.pillars : [profile.niche];
  const pillar = singularize(pillarList[Math.abs(index) % pillarList.length] ?? profile.niche);
  /**
   * The subject a title should carry is what the post behind the pattern was
   * actually about — "morning routine", "pov hostel student" — not the search
   * phrase the account was found by. Filling the slot with the niche produced
   * "My daily vlogs india routine", which is machine output, and it also meant
   * every idea in the feed was about the same empty thing.
   */
  const fromPattern = safeTopic(pattern.topic ?? "", "");
  const rawTopic = fromPattern || safeTopic(pillar, profile.niche);
  const topic = lowerFirst(polish(rawTopic));

  // Rotate the templates so eight ideas from the same shape are not eight copies
  // of one title.
  const rotate = <T,>(list: T[], by: number) => [...list.slice(by % list.length), ...list.slice(0, by % list.length)];
  const openings = rotate(shape?.openings ?? [], index).map((o) => fill(o, topic));
  const titles = rotate(shape?.titles ?? [], index).map((t) => fill(t, topic));
  const title = titles[0] ?? `${shape?.label ?? "Video"} — ${topic}`;

  const effort: DraftIdea["effort"] =
    shapeId === "day_in_life" || shapeId === "come_with_me" ? "medium" : "low";

  return {
    title,
    hookVariants: openings.length ? openings.slice(0, 3) : [title],
    hookType: pattern.hookType,
    format: SHAPE_CONTAINER[shapeId],
    topic: polish(rawTopic),
    beats: (shape?.beats ?? []).map((b) => fill(b, topic)),
    shotList: (shape?.shots ?? []).map((s) => fill(s, topic)),
    onScreenText: (shape?.overlays ?? []).map((o) => fill(o, topic)),
    sound: undefined,
    soundWindowDays: undefined,
    caption: truncate(title, 110),
    hashtags: [
      ...new Set(
        [topic, shape?.label ?? "", profile.niche].map(hashtag).filter((h) => h.length > 3),
      ),
    ].slice(0, 3),
    whyThis: `“${shape?.label ?? "These"}” videos broke out for accounts your size. This one is about ${topic}.`,
    effort,
    pattern,
  };
}

/**
 * The feed for a video-shaped account: one idea per shape the plan named.
 * Plans store the label ("Day in the life"), so it is resolved back to an id;
 * when a plan named none, the shapes come from the patterns themselves.
 */
export function formatDrafts(profile: Profile, patterns: PatternCard[]): DraftIdea[] {
  const ids: VideoFormatId[] = [];
  for (const label of profile.formats ?? []) {
    const id = formatIdFromLabel(label);
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (!ids.length) {
    for (const p of patterns) {
      const id = CONTAINER_SHAPE[p.format];
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  if (!ids.length) ids.push("day_in_life", "numbered_list", "first_time");

  const ordered = distinctFirst(patterns);
  return ids
    .slice(0, 8)
    .map((id, i) => formatDraft(profile, ordered[i % ordered.length], id, i));
}

/**
 * Final gate before ranking: read every idea against the reel it came from and
 * throw out the ones that are the same video with new nouns. Cheap — one call
 * for the whole batch — and it exists because the lexical check in rank.ts
 * cannot see a synonym swap.
 */
async function auditCopying(drafts: DraftIdea[]): Promise<DraftIdea[]> {
  if (!llmReady() || drafts.length === 0) return drafts;

  const pairs = drafts.map((d, i) => ({
    i,
    source: d.pattern.hookText.slice(0, 240),
    sourceTopic: d.pattern.topic,
    idea: (d.hookVariants[0] ?? d.title).slice(0, 240),
    ideaTopic: d.topic,
  }));

  let verdicts: { i: number; verdict: string; why: string }[] = [];
  try {
    const res = await jsonCall<{
      verdicts: { i: number; verdict: string; why: string }[];
    }>(AUDIT_SYSTEM, JSON.stringify({ pairs }), {
      temperature: 0,
      maxTokens: 1500,
    });
    verdicts = res.verdicts ?? [];
  } catch {
    // An audit outage must not empty the feed. The lexical gate still ran.
    return drafts;
  }

  const copied = new Set(
    verdicts.filter((v) => v.verdict === "copy").map((v) => v.i),
  );
  for (const v of verdicts) {
    if (v.verdict === "copy") {
      console.log(`[adapt] copy rejected: "${drafts[v.i]?.title}" — ${v.why}`);
    }
  }

  /**
   * Keep a floor: if nearly everything was flagged the source set was too
   * narrow to learn anything new from, and serving three honest ideas beats
   * serving none.
   */
  const clean = drafts.filter((_, i) => !copied.has(i));
  if (clean.length < Math.min(4, drafts.length)) {
    console.warn(
      `[adapt] audit flagged ${copied.size}/${drafts.length}; keeping all to avoid an empty feed`,
    );
    return drafts;
  }
  console.log(`[adapt] audit rejected ${copied.size}/${drafts.length} as copies`);
  return clean;
}

export async function adapt(
  profile: Profile,
  patterns: PatternCard[],
  opts: { perPattern?: number } = {},
): Promise<DraftIdea[]> {
  const perPattern = opts.perPattern ?? 2;
  if (!patterns.length) return [];

  const family = familyOf(profile);

  if (!llmReady()) {
    if (family === "songs" && (profile.songs?.length ?? 0) > 0) {
      return musicDrafts(profile, patterns);
    }
    /**
     * A vlog, a fitness transformation or an unreadable account does not get
     * hook lines. Their ideas are video shapes — a day, a list, an attempt, a
     * before-and-after — because that is the thing they can actually change.
     */
    if (family === "formats" || family === "craft" || family === "none") {
      const shaped = formatDrafts(profile, patterns);
      if (shaped.length) return shaped;
    }
    const drafts: DraftIdea[] = [];
    const pillars = profile.pillars.length ? profile.pillars : [profile.niche];
    /**
     * Several pattern cards legitimately share a topic when a niche only yields
     * a handful of themes, which produced three near-identical ideas. Track what
     * has been used and re-roll onto an unused pillar instead of repeating.
     */
    const used = new Set<string>();
    patterns.forEach((p, i) => {
      for (let k = 0; k < perPattern; k++) {
        const pivot = pillars[(i + k) % pillars.length];
        let draft = mockDraft(profile, p, k === 0 ? p.topic : pivot, k, i);
        if (used.has(draft.topic.toLowerCase())) {
          const fresh = pillars.find(
            (pl) => !used.has(singularize(pl).toLowerCase()),
          );
          if (fresh) draft = mockDraft(profile, p, fresh, k, i + k + 1);
        }
        used.add(draft.topic.toLowerCase());
        drafts.push(draft);
      }
    });
    return drafts;
  }

  const creator = {
    niche: profile.niche,
    archetype: profile.archetype,
    /** decides what an idea IS — see the rules in SYSTEM */
    recommendation: family,
    songs: profile.songs,
    /** shapes the plan named, so the feed is built on the same evidence */
    formats: profile.formats ?? [],
    audience: profile.audience,
    offer: profile.offer,
    pillars: profile.pillars,
    voice: profile.voice,
    bannedWords: profile.bannedWords,
    constraints: profile.constraints,
    ownWinners: profile.ownWinners ?? [],
    audienceQuestions: profile.commentQuestions ?? [],
  };

  const byId = new Map(patterns.map((p) => [p.signalId, p]));
  const drafts: DraftIdea[] = [];
  let returned = 0;
  let dropped = 0;

  /**
   * Batched. Fourteen cards at two full ideas each is far more than one
   * max_tokens window holds, and a truncated response does not error — it just
   * stops early, which is why a 14-card run produced eight ideas. Five cards
   * per call fits comfortably and keeps every card covered.
   */
  const CHUNK = 5;
  for (let i = 0; i < patterns.length; i += CHUNK) {
    const chunk = patterns.slice(i, i + CHUNK);
    const payload = {
      creator,
      patternCards: chunk.map((p) => ({
        signalId: p.signalId,
        hookText: p.hookText,
        hookType: p.hookType,
        format: p.format,
        topic: p.topic,
        tension: p.tension,
        payoff: p.payoff,
        cta: p.cta,
        durationSec: p.durationSec,
        whyItWorked: p.whyItWorked,
        skeleton: p.skeleton,
      })),
      ideasPerPattern: perPattern,
    };

    try {
      const res = await jsonCall<{
        ideas: (Omit<DraftIdea, "pattern"> & { patternSignalId: string })[];
      }>(SYSTEM, JSON.stringify(payload), { temperature: 0.85, maxTokens: 6000 });

      returned += res.ideas?.length ?? 0;
      for (const idea of res.ideas ?? []) {
        const pattern = byId.get(idea.patternSignalId) ?? chunk[0];
        if (!idea.title || !idea.hookVariants?.length) {
          dropped++;
          continue;
        }
        drafts.push({
          title: idea.title,
          hookVariants: idea.hookVariants.slice(0, 3),
          hookType: (idea.hookType ?? pattern.hookType) as HookType,
          format: (idea.format ?? pattern.format) as FormatContainer,
          topic: idea.topic ?? pattern.topic,
          beats: (idea.beats ?? []).slice(0, 6),
          shotList: (idea.shotList ?? []).slice(0, 6),
          onScreenText: (idea.onScreenText ?? []).slice(0, 4),
          sound: idea.sound,
          soundWindowDays: idea.soundWindowDays,
          caption: idea.caption ?? "",
          hashtags: (idea.hashtags ?? []).slice(0, 3),
          whyThis: idea.whyThis ?? pattern.whyItWorked,
          effort: idea.effort ?? "low",
          pattern,
        });
      }
    } catch {
      /* one failed chunk must not lose the cards the others covered */
    }
  }

  console.log(
    `[adapt] model returned ${returned} ideas for ${patterns.length} cards ` +
      `(${dropped} dropped for missing title/hooks) -> ${drafts.length} usable`,
  );

  /**
   * Coverage backstop: a card that produced nothing gets the family's own shape
   * rather than vanishing, so the feed still reflects every theme the evidence
   * supported.
   */
  const covered = new Set(drafts.map((d) => d.pattern.signalId));
  const bare = patterns.filter((p) => !covered.has(p.signalId));
  if (bare.length && drafts.length) {
    if (family === "hooks") {
      for (const p of bare) drafts.push(mockDraft(profile, p, p.topic));
    } else {
      drafts.push(...formatDrafts(profile, bare));
    }
    console.log(`[adapt] ${bare.length} uncovered cards filled from the fallback shape`);
  }

  if (drafts.length) return auditCopying(drafts);
  // The model returned nothing usable. Fall back to the family's own shape, so a
  // vlogger never silently receives hook lines as the emergency fallback.
  return auditCopying(
    family === "hooks"
      ? patterns.map((p) => mockDraft(profile, p, p.topic))
      : formatDrafts(profile, patterns),
  );
}
