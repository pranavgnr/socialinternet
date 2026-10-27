export type Platform = "instagram" | "tiktok" | "youtube";

export type TrendPhase =
  | "emergence"
  | "acceleration"
  | "peak"
  | "saturation"
  | "decay";

export type HookType =
  | "result"
  | "challenge"
  | "number"
  | "reveal"
  | "confession"
  | "objection"
  | "contrarian"
  | "question";

export type FormatContainer =
  /** a song or routine performed to camera — the default shape for music accounts */
  | "performance"
  | "tutorial"
  | "challenge"
  | "before_after"
  | "listicle"
  | "story"
  | "pov"
  | "comparison"
  | "reaction"
  | "case_study";

export interface Benchmark {
  handle: string;
  platform: Platform;
  /** why this account is a benchmark, e.g. "same niche, 10x my size" */
  note?: string;
}

export interface Profile {
  niche: string;
  audience: string;
  offer: string;
  /**
   * The network the posts behind this profile were read from.
   *
   * Not derivable from the handle: the same name can exist on Instagram and
   * YouTube as two unrelated people. Without this the UI cannot tell the truth
   * about where a number came from, and links default to the wrong network.
   */
  platform?: Platform;
  /**
   * What kind of account this is (singer, teacher, maker…). Set from the posts,
   * never asked. It decides which idea shapes are allowed: a singer gets songs,
   * a teacher gets openings.
   */
  archetype?: string;
  /** songs worth covering, for music accounts — the idea feed is built on these */
  songs?: string[];
  /** 3-5 recurring themes the account is allowed to talk about */
  pillars: string[];
  /** short description of how they talk, used to keep the voice right */
  voice: string;
  bannedWords: string[];
  constraints: {
    solo: boolean;
    maxSeconds: number;
    setting: string;
  };
  benchmarks: Benchmark[];
  /** keywords used to find fresh reels beyond the benchmark accounts */
  keywords: string[];
  /**
   * Video shapes the plan named, for accounts whose lever is the shape of the
   * video rather than the song or the opening line. Carried onto the profile so
   * the idea feed is built on the same shapes the plan recommended.
   */
  formats?: string[];
  /** past posts that overperformed for THIS account — strongest grounding signal */
  ownWinners?: string[];
  /** real questions pulled from comments/DMs/Reddit */
  commentQuestions?: string[];
}

/**
 * What actually grabs a viewer in the first three seconds.
 *
 * This is the question no public view count can answer, so it is answered by
 * watching the reel: the audio is transcribed locally and the first frames are
 * read for on-screen text. "spoken" means the words carry it, "on_screen" means
 * written text does, "both" means the two are doing different jobs (which is
 * extremely common and invisible from the caption), "visual" means neither —
 * the picture is the hook and there is nothing to copy but the shot.
 */
export type HookMode = "spoken" | "on_screen" | "both" | "visual" | "unknown";

export interface HookReading {
  mode: HookMode;
  /** the words a viewer meets first, to be read back as evidence */
  hookText: string;
  /** what is said, first sentence */
  spoken?: string;
  /** what is written on the picture, in reading order */
  onScreen?: string[];
  /** ms after frame 0 that speech begins — a hook said at 0s is worth more */
  speechStartMs?: number;
  /** on-screen text is already up in the first second */
  textAtStart?: boolean;
  /**
   * The language whisper heard in the audio, with its confidence. Read by
   * asking for detection instead of assuming English, which is the difference
   * between "no words I can place" and "this is Telugu" on a reel whose
   * caption was written in English.
   */
  heardLang?: string;
  heardLangProb?: number;
  /** measured on the video, or guessed from the caption when tools are absent */
  basis: "measured" | "caption";
  /** why it fell back, when it did */
  note?: string;
  analysedAt?: string;
}

/** A public comment, kept only as text plus its own popularity. */
export interface RawComment {
  text: string;
  likes: number;
  username?: string;
  publishedAt?: string;
}

export interface RawReel {
  id: string;
  platform: Platform;
  account: string;
  followers?: number;
  url: string;
  caption: string;
  postedAt: string; // ISO
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  saves?: number;
  audioId?: string;
  audioName?: string;
  transcript?: string;
  onScreenText?: string;
  /**
   * Signed CDN link to the reel's own MP4, which the search payload carries for
   * free. Kept because it is the only way to read the reel itself — the script
   * of the lyrics, the words burned onto the frame — without buying the post.
   */
  mediaUrl?: string;
  /** what was said in the first seconds, when the video was actually watched */
  spoken?: string;
  /** the language the audio turned out to be in, and how sure the reader was */
  heardLang?: string;
  heardLangProb?: number;
  /** how this reel opens, measured from the video itself */
  hook?: HookReading;
  /** comments Instagram shows under the post, used to mine the next topic */
  topComments?: RawComment[];
  thumbnail?: string;
  durationSec?: number;
  hashtags?: string[];
  /** provider's own niche classification, e.g. "technology" */
  nicheLabel?: string;
  /** ISO-639-1 language of the content, from the provider when it reports one */
  language?: string;
  /** provider-computed outlier ratio (views / that account's median) */
  providerRatio?: number;
  /**
   * Which search shelf this row came from: "recent" (latest uploads), "shorts",
   * or "established" (a relevance-ranked page).
   *
   * Needed because the two shelves are selected by different rules and the
   * difference is not cosmetic. A relevance page is chosen *because* its videos
   * did well, so those rows beat their own channel's median by construction;
   * breakouts and freshness measured over them say "this room's winners are a
   * year old" no matter how alive it is. A recent page is unselected, so it is
   * the only honest witness for who is breaking out right now. Room *size* still
   * needs both, because the recent page alone is all newcomers.
   */
  sourceWindow?: "recent" | "established" | "shorts";
  /** median views of the account's recent posts, when the source returns it */
  baselineMedianViews?: number;
  /**
   * SocialCrawl's own free judgement of whether this row is about the query:
   * `p` is the probability, `sense` says whether the thing the query means is
   * present at all ("not_present" is the giveaway for a row that matched on a
   * shared word and means something else), and `spam` is a low-quality score.
   *
   * The vendor computes it on every search row for nothing, so throwing it away
   * means re-deriving by hand what is already known — and doing it worse: a
   * caption reading "lil fit check" shares no word with "music covers", while a
   * row judged `not_present` is one the model could see was something else.
   */
  relevance?: ReelRelevance;
}

export interface ReelRelevance {
  /** probability the reel is about the query, 0..1 */
  p: number;
  /** "target" when the query's meaning is present, "not_present" when it is not */
  sense?: string;
  /** 1.0 = exactly the topic; higher goes deeper into it */
  depth?: number;
  /** low-quality / spam score, 0..1 */
  spam?: number;
}

/** Usage stats for one audio/format, used to place it on the trend curve. */
export interface SoundStats {
  audioId: string;
  reelsLast7d: number;
  reelsPrev7d: number;
  uniqueAuthors: number;
  largeAuthorShare: number; // 0..1 share of reels by 500k+ accounts
  brandShare: number; // 0..1 share of reels by brand/business accounts
  firstSeenDaysAgo: number;
}

export interface ScoredSignal extends RawReel {
  /** median views of the account's last 20 posts — the control group */
  baseline: number;
  /** views / baseline */
  ratio: number;
  /**
   * What the ratio was measured against: the account's own median ("account",
   * the stronger claim) or the niche's typical reel ("niche", used for accounts
   * we only saw once, e.g. through a keyword search).
   */
  ratioBasis?: "account" | "niche";
  /**
   * How this reel earned its place in the pool.
   *
   * "strict" — cleared the headline gate (3x its own median, 5x the room's).
   * "top" — the room had too few strict outliers, so this is the strongest tail
   * that still beat the room by 2x. Downstream can say "top of a quiet room"
   * instead of implying a breakout that did not happen.
   */
  gate?: "strict" | "top";
  /** this reel's views-per-hour vs the account's typical views-per-hour */
  velocityIndex: number;
  engagementRate: number;
  /**
   * Days since posting, or `null` when the source published no date.
   *
   * Nullable on purpose: freshness is a claim about time, and pretending an
   * undated post was brand new was the bug that made every YouTube Short look
   * like a fresh breakout. Consumers must read `null` as unknown, never as 0.
   */
  ageDays: number | null;
  phase: TrendPhase;
  /** 0 = wide open, 1 = burnt out */
  saturation: number;
  /** 0..100 */
  signalScore: number;
  receipts: string;
}

export interface PatternCard {
  signalId: string;
  hookText: string;
  hookType: HookType;
  format: FormatContainer;
  topic: string;
  tension: string;
  payoff: string;
  cta: string;
  durationSec: number;
  whyItWorked: string;
  /** the reusable skeleton, abstracted away from the original creator */
  skeleton: string;
}

export interface ScoreParts {
  signal: number;
  fit: number;
  novelty: number;
  timing: number;
  saturationPenalty: number;
  effortPenalty: number;
  /** cross-account validation, 0..100 */
  convergence: number;
}

export type ConvergenceTier = "validated" | "supported" | "single";

/**
 * One demand theme, assembled from outliers posted by DIFFERENT accounts.
 * A topic that outliers on three unrelated accounts is far stronger evidence
 * than a single 20x from one account (which may just be that creator's luck).
 */
export interface ConvergenceCluster {
  id: string;
  label: string;
  keywords: string[];
  signalIds: string[];
  /** distinct accounts, not reel count */
  accounts: string[];
  platforms: Platform[];
  support: number;
  medianRatio: number;
  maxRatio: number;
  bestPhase: TrendPhase;
  saturation: number;
  /** newest known age in the cluster, or null when no post carried a date */
  newestAgeDays: number | null;
  tier: ConvergenceTier;
  /** 0..1 — how much this theme is proven beyond one account */
  confidence: number;
  why: string;
}

/** What an idea stands on. Shown to the creator so the claim is checkable. */
export interface IdeaProof {
  support: number;
  accounts: string[];
  tier: ConvergenceTier;
  medianRatio: number;
  label: string;
}

export interface Idea {
  id: string;
  title: string;
  /** the product's real output: the first 3 seconds */
  hookVariants: string[];
  hookType: HookType;
  format: FormatContainer;
  topic: string;
  beats: string[];
  shotList: string[];
  onScreenText: string[];
  sound?: string;
  soundWindowDays?: number;
  caption: string;
  hashtags: string[];
  whyThis: string;
  effort: "low" | "medium" | "high";
  score: number;
  scoreParts: ScoreParts;
  receipt: {
    signalId: string;
    account: string;
    platform: Platform;
    url: string;
    ratio: number;
    phase: TrendPhase;
  };
  proof?: IdeaProof;
  status: "new" | "filmed" | "posted" | "skipped";
  viewsAfter7d?: number;
  createdAt: string;
}

/** One receipt behind a plan move. A move without one is not allowed to ship. */
export interface PlanEvidence {
  /** the account this was observed on */
  handle: string;
  /** e.g. "3.4x its usual views" */
  metric: string;
  /** the reel itself, so the claim can be checked in one tap */
  url?: string;
  /** what it was called, trimmed */
  caption?: string;
}

export interface PlanMove {
  id: string;
  title: string;
  /** why this is true for THIS account, in plain words */
  why: string;
  /** what to do this week */
  action: string;
  /** 1 = do this first */
  priority: number;
  evidence: PlanEvidence[];
}

export interface PlanGap {
  label: string;
  you: string;
  cohort: string;
}

/**
 * Which family of advice this account's lever belongs to.
 *
 * This is the decision that stops one template being handed to everybody: a
 * singer is given songs, a vlogger is given video shapes, a teacher is given
 * opening lines, a maker is given the reveal. Decided from the account's own
 * posts before a single recommendation is written.
 */
export type Recommendation = "songs" | "formats" | "hooks" | "craft" | "none";

/** What kind of account this is, so the page can say why the advice is shaped this way. */
export interface PlanArchetype {
  id: string;
  /** "singer", "teacher", "maker" — a noun the creator would use for themselves */
  label: string;
  language?: string;
  blurb: string;
  /** true when the song/audio choice is the biggest variable */
  songLed: boolean;
  /** which family of advice this account gets */
  recommendation: Recommendation;
}

/** One song worth covering, with the posts that prove it. */
export interface PlanSong {
  title: string;
  /** distinct accounts that posted it and beat their usual views */
  accounts: number;
  /** median multiple of those accounts' usual views */
  multiple: number;
  why: string;
  /** true when the evidence is the creator's own post, not a peer's */
  fromYou?: boolean;
  evidence: PlanEvidence[];
}

/**
 * One video shape worth making more of, with the posts that prove it.
 *
 * For a vlogger or a fitness account the shape of the video is the lever — a
 * "day in the life" cut around one decision travels, an unfocused one does not.
 * The shape is named, so the advice is something the creator can act on, not
 * the topic restated.
 */
export interface PlanFormat {
  id: string;
  /** "Day in the life", "Before and after" — the shape, in the creator's words */
  label: string;
  /** how the shape is built, one sentence */
  what: string;
  /** distinct accounts that posted this shape and beat their usual views */
  accounts: number;
  /** posts of this shape among the breakouts */
  posts: number;
  /** median multiple of those accounts' usual views */
  multiple: number;
  evidence: PlanEvidence[];
}

export interface PlanHook {
  id: string;
  /** "a question", "a warning" — the shape of the opener, in plain words */
  label: string;
  /** how to write it, one sentence, no template to copy */
  what: string;
  /** distinct accounts that opened this way and beat their usual views */
  accounts: number;
  /** posts that opened this way among the breakouts */
  posts: number;
  /** median multiple of those accounts' usual views */
  multiple: number;
  /** the strongest real opening line, so the claim can be checked */
  example: string;
  evidence: PlanEvidence[];
}

/** One cohort account, scored against the creator. */
export interface AccountFit {
  handle: string;
  reels: number;
  /** 0..1 — how much this account looks like the creator */
  fit: number;
  /** true when the account is clearly in another space */
  off: boolean;
  /** plain reason, only when the account is off */
  why?: string;
}

/**
 * Whether the cohort compares like with like.
 *
 * The phrase picked the search, the search picked the cohort, and every number
 * in the plan is a comparison against that cohort — so this is checked before
 * any number is used, and accounts in another space are dropped first.
 */
export interface CohortFit {
  searched: string;
  /** 0..1, the median account fit */
  score: number;
  /**
   * 0..1, the median caption overlap with the accounts that survived pruning.
   *
   * This is what decides "matches" once conflict is ruled out. `score` cannot
   * do it: shape is a 0.5 placeholder whenever either side is "general", which
   * is most accounts, so score alone cannot separate a real cohort from an
   * unrelated one. 0.5 means there was nothing to compare, not a tie.
   */
  agreement: number;
  verdict: "matches" | "mixed" | "wrong";
  ok: boolean;
  accounts: AccountFit[];
  /** handles left out of the benchmark */
  off: string[];
  creatorShape: string;
  creatorLanguage?: string;
  reasons: string[];
}

export interface GrowthPlan {
  handle: string;
  niche: string;
  /**
   * The network this plan's numbers were measured on. Carried on the plan, not
   * only on the profile, because every link and label on the page depends on it
   * and the ideas page never sees the profile object.
   */
  platform?: Platform;
  /**
   * The network the account itself lives on, as opposed to `platform`, which is
   * where the measured posts came from. They differ when the reels are served by
   * a fallback vendor — the follower count is still the real account's, so the
   * handle must link here, not to `platform`.
   */
  accountPlatform?: Platform;
  /** where the phrase came from: a model, the account's shape, its tags, or the visitor */
  nicheSource?: "model" | "hashtags" | "captions" | "shape" | "user";
  /** did the cohort end up comparing like with like */
  nicheFit?: CohortFit;
  generatedAt: string;
  archetype: PlanArchetype;
  /** only for accounts where the song is the decision */
  songs?: PlanSong[];
  /** only for accounts where the shape of the video is the decision */
  formats?: PlanFormat[];
  /** only for accounts where the opening line is the decision */
  hooks?: PlanHook[];
  /** the comparison group, so the advice is never "against the whole internet" */
  cohort: {
    accounts: number;
    /** how peers were chosen, e.g. "accounts within 2x your typical views" */
    basis: string;
    nicheMedianViews: number;
    /**
     * The network the cohort was measured on.
     *
     * Recorded separately from `platform` on purpose. `platform` is where the
     * creator's own posts came from; this is where the comparison came from.
     * With the paid Instagram source unavailable the research falls back to
     * YouTube, so the two can differ, and a median from one network is not a
     * fair yardstick for a post on another. The page has to be able to say so
     * rather than print the comparison as if it were like-for-like.
     */
    platform?: Platform;
  };
  /**
   * What the account says about itself — one 1-credit profile call.
   *
   * Only fetched for a creator who is already in the field: a bio and a category
   * are how you tell "singer" from "singer who teaches", and that changes which
   * moves are allowed. Absent for a new account, which has nothing to read.
   */
  account?: {
    followers?: number;
    posts?: number;
    bio?: string;
    category?: string;
    verified?: boolean;
    /** true when these numbers came from the profile call, not from a reel payload */
    measured?: boolean;
  };
  standing: {
    followers?: number;
    medianViews: number;
    bestViews: number;
    reelsRead: number;
    /** multiple of the niche's typical reel */
    vsNiche: number;
    /** share of the cohort this account out-performs, 0..1 */
    percentile: number;
  };
  /** two or three sentences, honest about what is a hunch */
  diagnosis: string;
  gaps: PlanGap[];
  moves: PlanMove[];
  /** what people in this niche are asking — raw material for hooks */
  questions: string[];
  /** the account read against itself: winners vs losers, cadence, formats */
  audit?: CreatorAudit;
  /** the single thing to do this week — everything else is behind it */
  nextMove?: NextMove;
  /** what the audience actually said under the breakouts */
  comments?: CommentMining;
  /** whether the thing that stops the scroll is in the picture or in the sound */
  hookRead?: HookVerdict;
  /**
   * The language gate, when it had anything to do. `kept` of `seen` reels in the
   * pull were in the room's language; the rest were another language and never
   * reached the maths. Carried so the page can say the number out loud instead
   * of leaving a thin result unexplained.
   */
  language?: {
    wanted: string | null;
    /**
     * How the room's language was decided: named in the phrase, read off the
     * creator's own account, inferred from a pull that was clearly one language,
     * or not decided at all because the evidence was a plurality, not a
     * majority. The page says which, because "inferred" and "named" are not the
     * same claim.
     */
    basis?: "query" | "own" | "pull" | "none";
    /** the phrase's own word for it, e.g. "english" */
    word?: string;
    /** reels in the deciding sample that carried explicit language evidence */
    labelled?: number;
    /** share of those that agreed */
    share?: number;
    kept: number;
    seen: number;
    dropped: number;
    /**
     * How much of the room rests on something harder than a caption — provider
     * language, script, a tag, a romanised title, the lyrics, the comments.
     * `caveat` is the sentence the page prints when that share is low.
     */
    evidence?: { hard: number; soft: number; share: number };
    caveat?: string;
    /** reels watched because their caption and tags could not settle it */
    watched?: {
      candidates: number;
      watched: number;
      dropped: number;
      confirmed: number;
      silent: number;
      skipped?: string;
    };
  };
}

/**
 * Where the hook actually lives.
 *
 * "Make a better hook" is not advice. Whether the opening works because of what
 * is said, what is written on the screen, or what is simply happening on camera
 * changes what the creator films tomorrow — and only a looked-at video can say.
 */
export interface HookVerdict {
  mode: HookMode;
  /** 0..1 share of the sampled posts that open this way */
  share: number;
  /** how many posts were actually watched (transcribed / OCR'd) */
  sampled: number;
  /** measured on the video, or inferred from the caption when tools are absent */
  basis: "measured" | "caption";
  sentence: string;
  /** the strongest openings, to be read back as evidence */
  examples: { text: string; views: number; url: string }[];
}

/** One difference between what worked for this account and what did not. */
export interface AuditGap {
  lever: "opening" | "length" | "cadence" | "shape" | "caption" | "consistency";
  /** what the posts that worked had */
  winners: string;
  /** what the posts that did not had */
  losers: string;
  /** distinct winners on the winning side — 1 is an anecdote */
  support: number;
  /** 0..1, how much the two groups actually differ */
  strength: number;
  note: string;
}

/**
 * The creator's own account, read as evidence.
 *
 * A beginner has no follower history to be measured against, but they always
 * have their own posts, and the gap between their best and worst post is the
 * most credible data they will ever be given — it is proof about them, not
 * advice about someone else.
 */
export interface CreatorAudit {
  posts: number;
  /** reels actually watched (transcribed / OCR'd), not just counted */
  watched: number;
  medianViews: number;
  best: { views: number; multiple: number; caption: string; url: string; hookMode?: HookMode };
  worst: { views: number; multiple: number; caption: string; url: string; hookMode?: HookMode };
  cadence: {
    medianGapDays: number | null;
    longestGapDays: number | null;
    daysSinceLast: number | null;
  };
  shapes: { label: string; posts: number; share: number; medianViews: number }[];
  hookModes: { mode: HookMode; posts: number; medianViews: number }[];
  /** distinct shapes tried — the thing beginners get wrong before hooks */
  breadth: number;
  /** 0..1: how steady the view counts are run to run */
  consistency: number;
  /** best / median */
  ceiling: number;
  /** how far the account stands out from its peers, as a plain sentence */
  versusPeers: string;
  gaps: AuditGap[];
}

/** The one instruction. Ten ideas compete with each other; one does not. */
export interface NextMove {
  title: string;
  /** why this, for this account, in plain words */
  why: string;
  /** what to do this week, concretely */
  action: string;
  /** what to stop, when the evidence is that clear */
  stop?: string;
  evidence: PlanEvidence[];
  /** 0..1 */
  confidence: number;
  basis: "your own posts" | "accounts your size" | "your own posts + accounts your size";
  /** how they will know in seven days whether it worked */
  checkOn: string;
}

/** One thing the audience asked for, with the comments behind it. */
export interface CommentSeed {
  /** the question or request, in the audience's own words */
  text: string;
  /** how many times it came up across the reels that were read */
  asked: number;
  /** likes on the strongest instance */
  likes: number;
  kind: "question" | "objection" | "request" | "story";
  /** what to make from it */
  ideas: string[];
}

/**
 * The comments under the reels that broke out.
 *
 * Public view counts say what travelled. The comments say why people stayed,
 * and they are written in the audience's own words — which is the one thing a
 * creator cannot invent and an LLM cannot fake convincingly.
 */
export interface CommentMining {
  posts: number;
  read: number;
  questions: string[];
  objections: string[];
  requests: string[];
  seeds: CommentSeed[];
  /** the recurring word or phrase people use for the problem */
  language: string[];
}

export interface RunLog {
  id: string;
  startedAt: string;
  finishedAt?: string;
  mode: "demo" | "live";
  steps: { name: string; detail: string; ms: number }[];
  counts: {
    signals: number;
    patterns: number;
    ideas: number;
    /** number of demand themes backed by 2+ independent accounts */
    converged?: number;
  };
  /** what the pull cost, so a run log can be audited without the dashboard */
  credits?: {
    spent: number;
    calls: number;
    remaining: number | null;
    /** true when the pull was served from disk and cost nothing */
    cached: boolean;
  };
  errors: string[];
}
