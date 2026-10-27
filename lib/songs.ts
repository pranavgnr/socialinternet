import { FORMAT_WORDS } from "./archetype";
import type { Row } from "./stats";
import { median } from "./stats";
import type { RawReel } from "./types";

/**
 * Which song is this reel about?
 *
 * The data source returns an audio field on roughly one reel in twenty, so the
 * song cannot be read from metadata. It is, however, almost always written in
 * the caption by the creator themselves — "Darkhaast - Cover", "falak tak
 * (cover)", "Arz Kiya Hai – Sargam Part", "Kannada Cover 28/100 - ನೀನೆಂದರೆ…" —
 * or carried in a hashtag named after the song.
 *
 * For a singer the song is the single biggest variable in the reel, so this is
 * the most valuable extraction in the whole product. The rules below are tuned
 * against real Indian music-cover captions, not invented examples.
 */

export interface SongEvidence {
  account: string;
  url: string;
  caption: string;
  views: number;
  /** views vs that account's usual */
  ratio: number;
  /** false when the ratio was taken against the niche, not the account */
  accountBased: boolean;
}

export interface SongPick {
  title: string;
  slug: string;
  /** distinct accounts that posted it */
  accounts: string[];
  evidence: SongEvidence[];
  medianRatio: number;
  maxRatio: number;
  /** true when every account that posted it is the creator themselves */
  fromOwn: boolean;
  /** how much to trust "cover this": proven = 2+ accounts */
  strength: "proven" | "promising";
  /**
   * What the ratio was measured against, for picks built from the creator's own
   * posts. "account" = their own usual views; "niche" = the typical post in
   * their space, used when one post is all we hold and a median of one number
   * would just be 1.0 and say nothing.
   */
  basis?: "account" | "niche";
}

/** Words that describe the container, never the song. */
const LEADING = new Set([
  "cover",
  "covers",
  "song",
  "songs",
  "singing",
  "sung",
  "vocals",
  "vocal",
  "version",
  "female",
  "male",
  "original",
  "unplugged",
  "acoustic",
  "live",
  "new",
  "full",
  "of",
  "the",
  "a",
  "an",
]);

const TRAILING = new Set([
  "cover",
  "covers",
  "coversong",
  "song",
  "songs",
  "singing",
  "vocals",
  "vocal",
  "version",
  "female",
  "male",
  "original",
  "remix",
  "unplugged",
  "acoustic",
  "live",
  "reel",
  "reels",
  "video",
  "audio",
  "status",
  "lyrics",
  "lyric",
  "full",
  "new",
  "part",
  "title",
  "serial",
  "movie",
  "film",
  "theme",
  "bgm",
  "mashup",
  "medley",
  "sargam",
]);

/**
 * Words that mean this line is a sentence about the reel rather than the name
 * of a song. "Hope I passed on the vibe" and "Needs no introduction" both used
 * to survive as song titles before this list.
 */
const SENTENCE_STRONG = new Set([
  "i",
  "im",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "this",
  "these",
  "those",
  "his",
  "her",
  "their",
  "they",
  "them",
  "he",
  "she",
  "bro",
  "broke",
  "breaks",
  "starts",
  "started",
  "gift",
  "phone",
  "vibe",
  "vibes",
  "hope",
  "needs",
  "need",
  "wait",
  "listen",
  "tag",
  "share",
  "comment",
  "follow",
  "today",
  "tomorrow",
  "yesterday",
  "guys",
  "everyone",
  "friends",
  "missed",
  "miss",
  "thank",
  "thanks",
  "please",
  "watch",
  "check",
  "link",
  "bio",
  "dm",
]);

/**
 * Words that only occur in a sentence, never in a film-song title.
 *
 * Deliberately excludes the small English words that DO occur in romanised
 * Indian titles — "to" ("Dil To Pagal Hai"), "hai", "of", "in", "the" — because
 * rejecting those loses more real songs than it saves. What is left is the
 * grammar of a caption: pronouns and copulas. "The ending is hilaaaarious" and
 * "how many of you remember this song" are both sentences, and neither is a
 * song, which is why they used to be recommended as one.
 */
const SENTENCE_STRICT = new Set([
  "i",
  "im",
  "ive",
  "you",
  "your",
  "youre",
  "we",
  "our",
  "they",
  "them",
  "their",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "he",
  "she",
  "his",
  "her",
  "is",
  "are",
  "was",
  "were",
  "am",
  "been",
  "has",
  "have",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "gonna",
  "wanna",
  "gotta",
  "just",
  "really",
  "actually",
  "literally",
  "how",
  "why",
  "what",
  "when",
  "where",
  "who",
]);

/**
 * A title in quotes is the creator telling us the name. Promo captions lead with
 * a slogan and put the real song further down in quotation marks — "Dream to
 * reality✨ … haadu “Bandhana Noda Chendulla Cheluva”" — so this runs before any
 * line guessing and wins when it finds something.
 */
const QUOTED = /[“"‘']([^”"’']{2,60})[”"’']/g;

/**
 * The first line of a singer's reel is very often something other than the song:
 * a festival greeting, a birthday wish, a crowd shot from a gig. Every one of
 * these was being recommended as a song to cover, which is the most damaging
 * kind of wrong for this product — the recommendation is the headline.
 */
/**
 * How a caption opens when it is NOT about a song. Matched as prefixes rather
 * than whole words, because the giveaway word gets stretched — "Blooperrrrr",
 * "Celebration", "congrats!!" — and an exact match misses all of them.
 */
const NON_SONG_PREFIX = [
  "happy",
  "advance",
  "wish",
  "congrat",
  "celebrat",
  "festival",
  "birthday",
  "tribute",
  "remember",
  "throwback",
  "latergram",
  "rehearsal",
  "rehears",
  "practi",
  "concert",
  "show",
  "promo",
  "teaser",
  "snippet",
  "announc",
  "update",
  "behind",
  "bts",
  "bloop",
  "crowd",
  "ticket",
  "dump",
  "glimps",
  "unseen",
  "exclusiv",
  "last",
  "after",
  "before",
  "today",
  "tomorrow",
  "yesterday",
  "watch",
  "listen",
  "thank",
  "sorry",
  "trending",
  "viral",
];

const META_WORDS = new Set([
  "crowd",
  "blooper",
  "bloopers",
  "ticket",
  "tickets",
  "dump",
  "rehearsal",
  "practice",
  "promo",
  "teaser",
  "snippet",
  "announcement",
  "update",
  "bts",
  "behind",
  "concert",
  "show",
  "stage",
  "recap",
  "vlog",
  "glimpse",
  "unseen",
  "exclusive",
  "cuties",
  "cutie",
  "guys",
  // genre labels sit on the reel, they are not what she sang. The Indic ones are
  // written as escapes so they cannot drift from what the caption actually
  // contains — a visual copy of the glyph is not a reliable match.
  "janapada",
  "janappada",
  "folk",
  "classical",
  "devotional",
  "bhajan",
  "\u0CB6\u0CCB", // ಶೋ — "show"
  "\u0C9C\u0CBE\u0CA8\u0CAA\u0CA6", // ಜಾನಪದ — "folk"
  // broadcasters, not songs
  "zee",
  "colors",
  "sony",
  "etv",
  "udaya",
  "surya",
  "vijay",
  "gemini",
]);

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2900}-\u{297F}]/gu;

const GENERIC_TAGS = new Set(
  (
    "fyp fy fypシ fypage fyppage viral viralreels trending trend explore explorepage " +
    "reels reel reelsinstagram instagram instagramreels reeltrend reelsvideo reelsfyp " +
    "foryou foryoupage foryoupageシ love like share subscribe follow followforfollowback " +
    "likesforlike support reelsindia reelkarofeelkaro instadaily instagood short shorts " +
    "youtube ytshorts music cover covers coversong songsong singing song singer vocals " +
    "musician indiansingers indianmusic trendingreels trendingaudio viralcovers " +
    "singersofinstagram singersofinsta musiclover musiclovers newpost"
  ).split(/\s+/),
);

const LANGUAGE_WORDS = new Set(
  (
    "telugu kannada tamil malayalam hindi marathi bengali punjabi gujarati urdu " +
    "tollywood kollywood sandalwood mollywood bollywood indian india desi south"
  ).split(/\s+/),
);

const ALNUM = /[\p{L}\p{N}]/u;

export function songSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/**
 * Strip a "Cover 28/100 -" / "DAY 24/30:" style series marker.
 *
 * Creators often put a language in front of it ("Kannada Cover 28/100 -"), so
 * the marker is not anchored to the start of the line — anything in the first
 * few words is allowed to sit before it.
 */
function stripSeries(line: string): string {
  return line
    .replace(
      /^(.{0,24}?)(?:day|cover|song|ep|episode|part)\s*\[?\s*\d+\s*[/\-–]\s*\d+\s*\]?\s*[-–—:.)]?\s*/i,
      "$1",
    )
    .replace(/^\s*\[?\s*\d+\s*[/\-–]\s*\d+\s*\]?\s*[-–—:.)]\s*/, "")
    .replace(/^\s*(?:day|ep|episode|part)\s*\d+\s*[-–—:.)]\s*/i, "")
    .trim();
}

/** Does this fragment still read like a song name rather than a sentence? */
/** Any single word that marks the line as something other than a song name. */
function metaWord(word: string): boolean {
  const w = word.toLowerCase();
  if (META_WORDS.has(w)) return true;
  // stretched for effect: "blooperrrrr", "crowddd"
  return NON_SONG_PREFIX.some((p) => p.length >= 5 && w.startsWith(p));
}

/** True when this whole line is an announcement, greeting or stage note. */
function lineIsNotASong(line: string): boolean {
  const first = words(songSlug(line))[0] ?? "";
  if (/\d/.test(first)) return true; // "8 years back", "25th year…"
  if (NON_SONG_PREFIX.some((p) => first.startsWith(p))) return true;
  return words(songSlug(line)).some(metaWord);
}

/**
 * Public guard, so anything holding a song title can check it against the same
 * rules the extractor uses. A stored title outlives the code that wrote it: a
 * plan built before the rejection lists were tuned still carries lines like
 * "ending is hilaaaarious", and the idea feed put them in quotation marks as a
 * song to cover. Filtering with the extractor's own rules keeps the two in step
 * — nothing real is lost, because anything this rejects was never extracted.
 */
export function readsLikeSongTitle(raw: string): boolean {
  return looksLikeTitle(raw) !== null;
}

function looksLikeTitle(raw: string, account?: string): string | null {
  let s = raw.replace(EMOJI, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^[\s\-–—:.,|•·]+|[\s\-–—:.,|•·]+$/g, "").trim();
  if (!s || s.length < 2 || s.length > 70) return null;
  if (!ALNUM.test(s)) return null;
  // A questioned or exclaimed line is the creator talking ("How many of you
  // remember this?", "Happy Vijayadashami!"), never a song name.
  if (/[!?]\s*$/.test(s)) return null;

  let list = words(s);

  // "Darkhaast Cover Song" → "Darkhaast": generic words only ever sit at the edges.
  while (
    list.length > 1 &&
    (LEADING.has(songSlug(list[0])) || LANGUAGE_WORDS.has(songSlug(list[0])))
  )
    list = list.slice(1);
  while (list.length > 1 && TRAILING.has(songSlug(list[list.length - 1])))
    list = list.slice(0, -1);

  /**
   * A language named in the middle of a title is a label, not the song:
   * "Saiyaara Malayalam version" is the song "Saiyaara" sung in Malayalam.
   */
  list = list.filter(
    (w) => !LANGUAGE_WORDS.has(songSlug(w)) || list.length === 1,
  );

  if (!list.length || list.length > 5) return null;

  const cleaned = list.join(" ").replace(/[\s,;:–—-]+$/u, "").trim();
  if (!cleaned || cleaned.length < 2) return null;
  // A separator surviving to this point means the cut above missed and this is
  // one line with two thoughts in it ("AA23 theme — drum").
  if (/[-–—|]/.test(cleaned)) return null;

  const normalised = words(songSlug(cleaned));
  if (!normalised.length) return null;

  // A single short token with digits in it ("AA23") is a film code, not a song.
  if (normalised.length === 1 && normalised[0].length < 5) return null;
  if (normalised.length === 1 && /\d/.test(normalised[0])) return null;

  let strong = 0;
  let strict = 0;
  let hasLetterRun = false;
  for (const w of normalised) {
    if (SENTENCE_STRONG.has(w)) strong += 1;
    if (SENTENCE_STRICT.has(w)) strict += 1;
    if (w.length >= 3 && /^[a-z]+$/.test(w)) hasLetterRun = true;
  }
  if (strong >= 1) return null;
  for (const w of normalised) if (metaWord(w)) return null;
  // A number inside a name ("ನಮ್ಮೂರ ಹಬ್ಬ 2.0", "Sesh 02") is a label on an event,
  // not a song. Film codes were already caught; this catches the rest.
  if (normalised.some((w) => /^\d+([.,]\d+)?$/.test(w))) return null;
  /**
   * A creator naming their own brand. The band account posted its event name in
   * quotes, which would otherwise be read as the song it performed.
   */
  const own = account ? songSlug(account).replace(/\s+/g, "") : "";
  if (own && normalised.some((w) => w.length >= 5 && own.includes(w.replace(/\s+/g, ""))))
    return null;
  /**
   * One pronoun or copula is enough. A title is a noun phrase; a sentence has a
   * subject and a verb in it, and a single "is" or "this" is the cheapest way to
   * tell them apart. Checked on the words BEFORE the leading/stripping above, so
   * dropping a leading "The" cannot hide the sentence underneath it.
   */
  if (strict >= 1) return null;
  for (const w of words(songSlug(raw))) if (SENTENCE_STRICT.has(w)) return null;
  // Latin-script titles need at least one real word in them; Indic titles are
  // accepted on their own script.
  if (!hasLetterRun && !/[\u0900-\u0DFF]/.test(cleaned)) return null;

  void account;
  return cleaned;
}

/**
 * The song this reel is about, from the caption.
 *
 * Order matters: the title is usually the first line, cut at the first real
 * separator. "Kannada Cover 28/100 - ನೀನೆಂದರೆ ನನ್ನೊಳಗೆ" has a useless left side
 * and a useful right side, so both sides are tried in turn rather than assuming
 * the title comes first.
 */
export function songFromCaption(caption: string, account?: string): string | null {
  const body = caption
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\w.]+/g, " ")
    .replace(EMOJI, " ");
  const line =
    body
      .split(/\n/)
      .map((l) => l.trim())
      .find((l) => l.replace(/[^\p{L}]/gu, "").length >= 2) ?? "";
  if (!line) return null;

  // The creator naming the song outright beats any guessing below.
  for (const q of body.matchAll(QUOTED)) {
    const quoted = looksLikeTitle(q[1], account);
    if (quoted) return quoted;
  }

  /**
   * If the line is a greeting or an announcement, no fragment of it is a song.
   * "25th year's a grand musical concert from Katte Boys" splits into a clean
   * two-word tail that looks exactly like a title, so the decision has to be
   * made on the whole line before it is cut up.
   */
  if (lineIsNotASong(line)) return null;

  const stripped = stripSeries(line);

  // "Adiga Adiga from Ninnukori" → the song is the part before "from".
  const parts = stripped
    .split(/\s+[-–—|]\s+|\s*[|(]\s*|:\s+|\s+from\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    const title = looksLikeTitle(part, account);
    if (title) return title;
  }

  // No separator at all ("Zara Zara ❤️", "Sita Rama Serial Title Song 🎶").
  return looksLikeTitle(stripped, account);
}

/**
 * A song carried only by a hashtag ("#ninnukori", "#arzkiyahai"). Only used when
 * the caption gave nothing, because a tag is a weaker claim than a written title.
 */
export function songFromTags(
  hashtags: string[] | undefined,
  caption: string,
  account?: string,
): string | null {
  if (!hashtags?.length) return null;
  const captionText = songSlug(caption.replace(/[#@][\w.]+/g, " "));
  const captionKey = captionText.replace(/\s+/g, "");
  const captionWords = captionText.split(/\s+/).filter(Boolean).length;
  const own = account ? songSlug(account).replace(/\s+/g, "") : "";

  const candidates = hashtags
    .map((t) => t.replace(/^#/, ""))
    .filter((t) => t.length >= 4 && t.length <= 30)
    .filter((t) => !GENERIC_TAGS.has(t.toLowerCase()))
    .filter((t) => !LANGUAGE_WORDS.has(t.toLowerCase()))
    .filter((t) => !FORMAT_WORDS.has(t.toLowerCase()))
    .filter((t) => {
      const l = t.toLowerCase();
      if (own && (l.includes(own) || own.includes(l))) return false;
      // "hindisongs", "telugumusiccovers": a language glued to a format word
      if ([...LANGUAGE_WORDS].some((lang) => l.startsWith(lang) && l.length > lang.length + 3))
        return false;
      return true;
    })
    .filter((t) => {
      /**
       * A tag names the song only when the caption has nothing else to name it
       * with. "#skincare" on a paid promotion passed this test because the word
       * also appeared in the caption, and the plan then suggested covering
       * "skincare". Long captions must earn their song from the caption itself.
       */
      const key = songSlug(t).replace(/\s+/g, "");
      // A caption made only of hashtags cannot tell us which tag is the song:
      // "#sgopalreddy #mmkeeravani" are people, not titles. No song then.
      if (captionWords === 0) return false;
      return captionWords <= 6 && captionKey.includes(key);
    });

  for (const t of candidates) {
    const spaced = t.replace(/[_.]+/g, " ").trim();
    const title = looksLikeTitle(spaced, account);
    if (title) return title;
  }
  return null;
}

/**
 * The best available song name for one reel.
 *
 * The provider's audio field is deliberately not used: on a singer's reel it is
 * whatever backing track the app attached, and it named a reel "A Gentle
 * Sunlight" that had nothing to do with what she sang.
 */
export function songOf(reel: RawReel): string | null {
  return (
    songFromCaption(reel.caption, reel.account) ??
    songFromTags(reel.hashtags, reel.caption, reel.account)
  );
}

/**
 * Songs that broke out across the cohort, strongest first.
 *
 * Two accounts is the bar for "cover this" — one account is that creator's luck.
 * A single account is still kept, marked "promising", because with only a dozen
 * reels in a niche the bar has to be reachable or the section is always empty.
 *
 * `minSingle` decides how strong a single-account song has to be to survive. The
 * default is deliberately strict, because for most accounts a song is one option
 * among many. For a singer it is the only lever there is: she was being handed
 * "post on the idea behind the biggest post here" — a line with no song in it —
 * because the one song that did break out had a single account behind it and was
 * thrown away here. A song that beat its own account's usual views is a real
 * signal even when only one account carries it, so the caller may lower the bar
 * to that and let the wording say "signal", not "record".
 */
export function rankSongs(
  rows: Row[],
  ownHandle?: string,
  opts: { minSingle?: number } = {},
): SongPick[] {
  const minSingle = opts.minSingle ?? 2.5;
  const groups = new Map<
    string,
    { title: string; rows: Row[]; accounts: Set<string> }
  >();

  for (const row of rows) {
    const title = songOf(row.reel);
    if (!title) continue;
    const key = songSlug(title).replace(/\s+/g, "");
    if (key.length < 3) continue;
    const g = groups.get(key) ?? { title, rows: [], accounts: new Set<string>() };
    g.rows.push(row);
    g.accounts.add(row.account.toLowerCase());
    groups.set(key, g);
  }

  const own = ownHandle?.toLowerCase();

  return [...groups.entries()]
    .map(([key, g]) => {
      const evidence = g.rows
        .slice()
        .sort((a, b) => b.ratio - a.ratio)
        .map<SongEvidence>((r) => ({
          account: r.account,
          url: r.reel.url,
          caption: r.reel.caption.replace(/\s+/g, " ").slice(0, 120),
          views: r.reel.views,
          ratio: Number(r.ratio.toFixed(1)),
          accountBased: r.accountBased,
        }));
      const accounts = [...g.accounts];
      return {
        title: g.title,
        slug: key,
        accounts,
        evidence,
        medianRatio: median(evidence.map((e) => Math.round(e.ratio * 10))) / 10,
        maxRatio: Math.max(...evidence.map((e) => e.ratio)),
        fromOwn: Boolean(own && accounts.every((a) => a === own)),
        strength: accounts.length >= 2 ? "proven" : "promising",
      } satisfies SongPick;
    })
    .filter((s) => s.accounts.length >= 2 || s.medianRatio >= minSingle)
    .sort(
      (a, b) =>
        b.accounts.length - a.accounts.length ||
        b.medianRatio - a.medianRatio ||
        b.maxRatio - a.maxRatio,
    );
}

/**
 * Which songs did the creator's OWN reels do well with? The strongest possible
 * recommendation is a song that already worked for them, because the audience
 * has already voted on it.
 *
 * A median of one post is that post, so a creator we hold a single reel for used
 * to score every own song at exactly 1.0x and get nothing back — the one thing
 * we could say for certain ("this cover did 8.6x the typical post in your
 * space") was the thing withheld. When there is no usable own median the
 * comparison falls back to the niche, and the pick is marked so the wording can
 * say which denominator it used instead of claiming "your usual views".
 */
export function ownSongWinners(
  ownReels: RawReel[],
  ownMedian: number,
  nicheMedian = 0,
): SongPick[] {
  const posted = ownReels.filter((r) => r.views > 0);
  if (!posted.length) return [];

  const useOwn = posted.length >= 2 && ownMedian > 0;
  const denominator = useOwn ? ownMedian : nicheMedian;
  if (!denominator || denominator <= 0) return [];

  const rows: Row[] = posted.map((r) => ({
    reel: r,
    account: r.account,
    ratio: r.views / denominator,
    accountBased: useOwn,
  }));

  return rankSongs(rows, ownReels[0]?.account, { minSingle: 1.5 })
    .filter((s) => s.fromOwn)
    .map((s) => ({ ...s, basis: useOwn ? "account" : "niche" }) as SongPick);
}
