import { hasForeignWords, looksEnglish } from "./text";
import { isNoiseAudio, romanisedLanguage } from "./lexicon";

/**
 * Which language a post is in, and does it belong in the room we searched?
 *
 * Search is the weak link in the pipeline: Instagram's keyword search for
 * "english music covers" happily returns a Telugu film-song account, a Mexican
 * corridos singer and a Japanese tag-spam page, because all three also cover
 * songs. The topic gate did not catch it either — "cover" is a real topic word,
 * so a post tagged #telugucovers scored as relevant. The maths downstream was
 * then correct about the wrong room: outlier ratios, medians and "what works in
 * your space" all computed over someone else's audience.
 *
 * So language is a separate gate, not a topic word. Three sources of evidence,
 * strongest first: the provider's own language tag, the script the caption is
 * written in, and the language-specific hashtags creators use to sort
 * themselves (#telugucovers, #bollywood, #corridos, #kpop).
 *
 * The rule is deliberately one-sided: a post is dropped only when something
 * positively contradicts the searched language. A silent caption ("birthday
 * transition :)") is not evidence of Telugu, and dropping it would empty the
 * page for no gain. Only proof counts.
 */

/** Language names as people type them in a niche phrase. */
const NAMES: Record<string, string[]> = {
  en: ["english", "eng"],
  te: ["telugu", "tollywood"],
  hi: ["hindi", "bollywood", "hindustani"],
  ta: ["tamil", "kollywood"],
  kn: ["kannada", "sandalwood"],
  ml: ["malayalam", "mollywood"],
  pa: ["punjabi"],
  bn: ["bengali", "bangla"],
  mr: ["marathi"],
  gu: ["gujarati"],
  bho: ["bhojpuri"],
  ur: ["urdu"],
  tr: ["turkish", "turkiye", "turkce"],
  es: ["spanish", "espanol", "latino", "latin"],
  pt: ["portuguese", "brasileiro"],
  fr: ["french"],
  de: ["german"],
  it: ["italian"],
  ru: ["russian"],
  ar: ["arabic"],
  ko: ["korean", "kpop"],
  ja: ["japanese"],
  zh: ["chinese", "mandarin"],
  id: ["indonesian"],
  th: ["thai"],
  vi: ["vietnamese"],
  nl: ["dutch"],
  tl: ["tagalog", "filipino", "opm", "pinoy"],
  fa: ["farsi", "persian"],
  he: ["hebrew"],
  el: ["greek"],
  si: ["sinhala", "sinhalese"],
  ne: ["nepali"],
  or: ["odia", "oriya"],
  sw: ["swahili"],
  af: ["afrikaans"],
  uk: ["ukrainian"],
  pl: ["polish"],
  sv: ["swedish"],
  km: ["khmer"],
  my: ["burmese"],
  hy: ["armenian"],
  ka: ["georgian"],
  am: ["amharic"],
};

/** "en" → "English", for messages a person reads. */
export function languageName(code: string | null): string {
  if (!code) return "this language";
  const words = NAMES[code];
  if (!words) return code;
  const w = words[0];
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Every language word, so topic matching cannot count it as a subject. */
export const LANGUAGE_WORDS = new Set(
  Object.values(NAMES).flat().filter((w) => w !== "eng" && w !== "latin"),
);

export function isLanguageWord(word: string): boolean {
  return LANGUAGE_WORDS.has(word.toLowerCase());
}

/** Scripts that cannot be English. Ordered so the tightest range wins. */
const SCRIPTS: [RegExp, string][] = [
  [/[\u0C00-\u0C7F]/, "te"],
  [/[\u0C80-\u0CFF]/, "kn"],
  [/[\u0B80-\u0BFF]/, "ta"],
  [/[\u0D00-\u0D7F]/, "ml"],
  [/[\u0D80-\u0DFF]/, "si"],
  [/[\u0B00-\u0B7F]/, "or"],
  [/[\u0980-\u09FF]/, "bn"],
  [/[\u0A80-\u0AFF]/, "gu"],
  [/[\u0A00-\u0A7F]/, "pa"],
  [/[\u0E00-\u0E7F]/, "th"],
  [/[\u0900-\u097F]/, "hi"],
  [/[\u0600-\u06FF]/, "ar"],
  [/[\u0590-\u05FF]/, "he"],
  [/[\u0370-\u03FF]/, "el"],
  [/[\u0530-\u058F]/, "hy"],
  [/[\u10A0-\u10FF]/, "ka"],
  [/[\u0400-\u04FF]/, "ru"],
  [/[\u3040-\u30FF]/, "ja"],
  [/[\uAC00-\uD7AF]/, "ko"],
  [/[\u4E00-\u9FFF]/, "zh"],
  [/[\u1780-\u17FF]/, "km"],
  [/[\u1000-\u109F]/, "my"],
  [/[\u1200-\u137F]/, "am"],
];

/**
 * Hashtags creators use to place themselves.
 *
 * These were regular expressions tested as substrings, which quietly misfiled
 * people: "popmusic" contains "opm", "saudade" contains "saudi", "melodia"
 * contains "odia", and a Sydney R&B singer tagged #popmusic was thrown out of
 * the English room as Tagalog. Substring matching cannot tell #telugucoversong
 * (real) from #popmusic (not), so the rule is now positional: the language word
 * either stands alone as a tag, or is followed by a word from the vocabulary
 * tags are actually built from — cover, song, music, version, reels.
 */
const TAG_WORDS: [string[], string][] = [
  [["telugu", "tollywood"], "te"],
  [["kannada", "sandalwood"], "kn"],
  [["tamil", "kollywood", "tamizh"], "ta"],
  [["malayalam", "mollywood"], "ml"],
  [["bollywood", "hindi", "hindustani", "desi"], "hi"],
  [["punjabi"], "pa"],
  [["bhojpuri"], "bho"],
  [["marathi"], "mr"],
  [["bangla", "bengali"], "bn"],
  [["gujarati", "garba"], "gu"],
  [["odia", "oriya"], "or"],
  [["sinhala"], "si"],
  [["nepali"], "ne"],
  [["urdu"], "ur"],
  [["tagalog", "opm"], "tl"],
  [["turkish", "turkce"], "tr"],
  [["latinmusic", "corrido", "musicamexicana", "espanol", "reggaeton", "ranchera"], "es"],
  [["sertanejo", "funkbrasileiro"], "pt"],
  [["kpop", "korean"], "ko"],
  [["jpop", "anime", "japanese"], "ja"],
  /**
   * Arabic reach is wider than the word "arabic": a Lebanese or Khaleeji cover
   * is tagged by the dialect's country, not the language ("#lebanese",
   * "#khaleeji"), and that is exactly the case that slipped through.
   */
  [["arabic", "lebanese", "khaleeji", "saudi", "egyptian", "moroccan", "habibi"], "ar"],
  [["farsi", "persian"], "fa"],
  [["hebrew"], "he"],
  [["greek", "ellinika"], "el"],
  [["vietnamese"], "vi"],
  [["thai"], "th"],
  [["indonesian", "melayu"], "id"],
  [["swahili", "bongoflava"], "sw"],
  [["afrikaans"], "af"],
  [["deutsch", "german"], "de"],
  [["francais", "french"], "fr"],
  [["italiano", "italian"], "it"],
  [["polski", "polish"], "pl"],
  [["nederlands", "dutch"], "nl"],
  [["svenska", "swedish"], "sv"],
  [["ukrain"], "uk"],
  /**
   * Film-song titles as tags. "#discodeewane", "#chuttamalle" — one word, and
   * the single most common way an Indian cover labels itself, because the song
   * is the search term its audience uses.
   */
  [["deewana", "deewane", "saiyaara", "kesariya", "ishq", "tumhiho", "jobhimain"], "hi"],
  [["chuttamalle", "samajavaragamana", "buttabomma", "vinadhuga", "nammaka"], "te"],
  [["english"], "en"],
];

/**
 * Tags that say where the creator is from, not what the song is.
 *
 * A Filipino creator covering English songs tags #englishmusiccovers *and*
 * #pinoy, and the first version of this reader threw her out of the English
 * room on the strength of her nationality. Identity is not content: these words
 * are read only when nothing says what the reel actually is.
 */
const PLACE_WORDS: [string[], string][] = [
  [["pinoy", "filipino", "pilipinas", "philippines"], "tl"],
  [["pakistani", "pakistan"], "ur"],
  [["israeli"], "he"],
  [["srilanka", "srilankan", "ceylon"], "si"],
  [["brasil", "brazil", "brasileiro"], "pt"],
  [["malaysia", "malaysian"], "id"],
  [["thailand"], "th"],
  [["vietnam"], "vi"],
  [["turkiye"], "tr"],
  [["mexico", "mexican"], "es"],
  [["korea"], "ko"],
  [["japan"], "ja"],
];

/** The words tags are built from: #telugucoversong, #hindisong, #englishtunes. */
const TAG_SUFFIX = "(cover|covers|coverr|song|songs|music|singer|version|reels|edit|status|lyrics|remix|lovers|fans|audio|playlist|tunes)";

/** The building blocks a tag is allowed to stack: #english + music + covers. */
const SUFFIXES = TAG_SUFFIX.replace(/[()]/g, "").split("|").sort((a, b) => b.length - a.length);

/** Can this leftover be eaten entirely by vocabulary words? "musiccovers" yes. */
function eatsSuffixes(rest: string): boolean {
  let left = rest;
  while (left.length) {
    const hit = SUFFIXES.find((s) => left.startsWith(s));
    if (!hit) return false;
    left = left.slice(hit.length);
  }
  return true;
}

/**
 * Does one hashtag place the post in the language `word` names?
 *
 * Three shapes count: the bare tag (#telugu), the tag with the vocabulary tags
 * are built from (#telugucoversong, #englishmusiccovers — which the old
 * one-suffix rule read as neither), and — for words long enough to be
 * unambiguous — a tag that ends in it (#discodeewane). Short words are not
 * allowed to match a tail, or "melodia" becomes Odia.
 */
function tagHas(token: string, word: string): boolean {
  const t = token.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/\d+$/, "");
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t || !w) return false;
  if (t === w) return true;
  /**
   * Plurals. "#corridos" is how a Mexican regional singer tags a genre and
   * "#rancheras" how they tag a song, and neither matched the singular word —
   * so two Spanish reels in an English pull were read as unlabelled and had to
   * be caught by their account instead of by what they said about themselves.
   */
  if (t === `${w}s` || t === `${w}es`) return true;
  if (t.startsWith(w) && eatsSuffixes(t.slice(w.length))) return true;
  return w.length >= 5 && t.endsWith(w);
}

/** The first language any of these word-lists matches, read tag by tag. */
function tagVote(tags: string[], words: [string[], string][]): string | null {
  for (const token of tags) {
    for (const [list, code] of words) {
      if (list.some((w) => tagHas(token, w))) return code;
    }
  }
  return null;
}

/**
 * The caption saying out loud what language it is: "an arabic cover", "tamil
 * song", "english version". Creators label themselves this way constantly, and
 * it was the last hole — a reel titled "since a lot of you guys wanted an
 * arabic cover" carries the answer in prose that no hashtag test reads.
 *
 * Whole words only, and the words come from the same table the phrase parser
 * uses, so "spanish guitar" counts and "englishing" does not.
 */
function claimedLanguage(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [code, words] of Object.entries(NAMES)) {
    for (const w of words) {
      if (w.length < 4) continue;
      /**
       * The language word has to be attached to a thing — "arabic cover",
       * "telugu song", "in malayalam" — not floating in a keyword list. Indian
       * creators stuff "English pop singer, Bollywood singer" into captions as
       * SEO, and a bare mention was enough to throw a Hindi cover out of the
       * Hindi room.
       */
      const attached = new RegExp(
        `(^|[^a-z])${w}\\s+(cover|covers|song|songs|version|lyrics|track|remix|mashup|lesson|speaking|accent|translation)`,
      );
      const sangIn = new RegExp(`(^|[^a-z])in\\s+${w}([^a-z]|$)`);
      if (attached.test(lower) || sangIn.test(lower)) return code;
    }
  }
  return null;
}

/**
 * Which non-Latin script this text is written in, if one really dominates it.
 *
 * Testing for the *presence* of a foreign letter is wrong in both directions.
 * A Russian-titled English cover (#yad (яд) ENGLISH COVER) has two Cyrillic
 * characters in an English sentence, and presence alone threw the cover out of
 * the English room. A reader goes by proportion, not by the existence of a
 * glyph, so this does too.
 */
function dominantScript(text: string): string | null {
  /**
   * Counted over characters, not over \p{L}: Indic scripts carry combining
   * marks that are not letters ("last \u0d2a\u0d31\u0d1e\u0d4d\u0d1e\u0d3e last" is four
   * letters and six characters), so a letters-only count under-reads every one
   * of them. Latin letters form the denominator's other half; punctuation,
   * emoji and digits belong to no language and are ignored.
   */
  let latin = 0;
  const counts = new Map<string, number>();
  for (const ch of text) {
    if (/\p{Script=Latin}/u.test(ch)) {
      latin += 1;
      continue;
    }
    for (const [re, code] of SCRIPTS) {
      if (re.test(ch)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
        break;
      }
    }
  }
  if (!counts.size) return null;
  let best: string | null = null;
  let n = 0;
  let other = 0;
  for (const [code, k] of counts) {
    other += k;
    if (k > n) {
      best = code;
      n = k;
    }
  }
  if (!best) return null;
  /**
   * Share of every letter in the text, English ones included: a bilingual
   * caption that is half Telugu is not an English post, and a Telugu caption
   * with three English hashtags still is. Two Cyrillic characters in seventy
   * characters of English are a song title, not a language.
   */
  return n / (latin + other) >= 0.25 ? best : null;
}

const ISO = /^[a-z]{2}$/;

/** "en-US" → "en"; "und"/"unknown"/"" → null. */
export function normaliseLang(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const code = v.trim().toLowerCase().split(/[-_]/)[0];
  if (!code || !ISO.test(code)) return null;
  if (code === "un" || code === "und" || code === "xx" || code === "zxx") return null;
  return code;
}

export interface LangReading {
  /** the language the content is most likely in, or null when nothing says */
  code: string | null;
  /** "provider" | "script" | "tag" | "words" | "english" — where it came from */
  from: string | null;
}

export interface LangInput {
  caption?: string;
  /** the payload sometimes sends a string, sometimes the parsed list */
  hashtags?: string[] | string;
  /** provider's computed language, when the source returns one */
  language?: string;
  /** the track under the reel — the song's own title, in its own language */
  audioName?: string | null;
  /** a list of texts, or the bare count a search result carries */
  comments?: (string | { text?: string | null })[] | number;
  /** the same list as it is named on RawReel after the deep pass buys it */
  topComments?: { text?: string | null }[];
  /**
   * Text burned into the video, when the deep pass read it. OCR of the first
   * frames carries the hook in whatever script the creator typed it in.
   */
  onScreenText?: string;
  /**
   * What was sung or said, when the reel was watched. This is the strongest
   * evidence there is for a cover: the lyrics are the content, and whisper
   * writes them in the song's own script — a Telugu song comes back in Telugu
   * however English its caption is.
   */
  spoken?: string;
  /** the same text under the name RawReel carries it by */
  transcript?: string;
  /**
   * The language whisper heard in the audio, and its confidence. This is what
   * `-l auto` buys: without detection the decoder assumes English and writes a
   * Telugu lyric as invented English words, which read as English evidence for
   * the exact reel the gate exists to catch.
   */
  heardLang?: string | null;
  heardLangProb?: number;
}

/**
 * Every hashtag on the post, one per entry.
 *
 * Tags are read one at a time rather than as one long string: "#englishmusiccovers
 * #pinoy" has two claims in it, and a single blob can only answer "does the word
 * appear anywhere", which is how a nationality tag outvoted a content tag.
 *
 * Hashtags are also written in the caption, and the search payload does not
 * always parse them into the array. Reading only the array missed
 * "…#telugucoversong" on every post where `ext.hashtags` came back empty.
 */
function tagList(post: LangInput): string[] {
  const h = post.hashtags;
  const fromArray = Array.isArray(h)
    ? h
    : typeof h === "string"
      ? h.split(/[\s,]+/)
      : [];
  const inCaption = (post.caption ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const all = [...fromArray, ...inCaption].map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
  return [...new Set(all)];
}

/** The text that describes the content, with meaningless audio names removed. */
function audioText(post: LangInput): string {
  const name = post.audioName;
  if (!name || isNoiseAudio(name)) return "";
  return name;
}

/**
 * Read a post's language. Provider first (it saw the audio), then the script,
 * then the creator's own tags, then romanised word evidence — the case where a
 * Telugu or Hindi song is written in Latin letters and the alphabet says
 * nothing ("barbaad - saiyaara", "nidhra poru emo") — then the "no English word
 * at all" test, then a caption that plainly is English.
 */
/** Whisper on a short music clip is a witness, not a judge: below this, ignore. */
const HEARD_MIN = 0.45;

export function readLanguage(post: LangInput): LangReading {
  const provider = normaliseLang(post.language);
  const heard = normaliseLang(post.heardLang);
  const heardProb =
    typeof post.heardLangProb === "number" ? post.heardLangProb : heard ? 1 : 0;
  const heardOk = Boolean(heard && heardProb >= HEARD_MIN);

  const caption = post.caption ?? "";
  const audio = audioText(post);
  const onScreen = post.onScreenText ?? "";
  /**
   * Whisper on a music bed sometimes hallucinates a phrase in a language
   * nobody sang, so a transcript is only allowed to speak for the reel when it
   * is long enough to be speech: four words. Under that it is noise, and noise
   * must never drop a good reel.
   */
  const spokenRaw = (post.spoken ?? post.transcript ?? "").trim();
  const spoken = spokenRaw.split(/\s+/).filter(Boolean).length >= 4 ? spokenRaw : "";

  /**
   * Hashtags are metadata and are written in English even by creators who post
   * in Malayalam or Telugu — counting them in the denominator let a short
   * caption be outvoted by its own tags ("ആര്‍ തൂക്കും #coversong #singing").
   * The share is read on the caption proper.
   */
  const bare = caption.replace(/https?:\/\/\S+/g, " ").replace(/[#@][\w.]+/gu, " ");

  /**
   * Content first, metadata second.
   *
   * This order is the fix for the whole complaint. Four things can say what
   * language a reel is in, and they are not equally close to the reel:
   *
   *   · what was heard in the audio — the song itself, and the reason a cover
   *     exists. Nothing else outranks it.
   *   · what is written on the reel — the burned-in title, the sung words.
   *   · what the creator typed around it — the caption, which is often English
   *     over a Telugu song, because English is how you reach the most people.
   *   · what a third party filed it as — the provider's language tag, which is
   *     computed at scale and, on this data, followed the caption: a
   *     Hindi-dubbed K-drama clip captioned in English came back `en`.
   *
   * The old order was provider → caption script → tags, which is metadata
   * first: exactly backwards for the case that broke.
   */
  if (heardOk) return { code: heard!, from: "heard" };

  const written = `${onScreen} ${spoken}`.trim();
  if (written) {
    const script = dominantScript(written);
    if (script) return { code: script, from: "video" };
    /**
     * Speech that is plainly English, long enough to be speech rather than a
     * decoder hallucination. This is how a watched reel is *confirmed* rather
     * than merely not contradicted: a silent caption left nothing to read, and
     * the pass used to be able to condemn but never to vouch.
     */
    if (spoken.split(/\s+/).filter(Boolean).length >= 5 && looksEnglish(spoken)) {
      return { code: "en", from: "spoken" };
    }
  }

  const captionScript = dominantScript(bare) ?? dominantScript(audio);
  if (captionScript) return { code: captionScript, from: "script" };

  const tags = tagList(post);
  const contentTag = tags.length ? tagVote(tags, TAG_WORDS) : null;
  if (contentTag) return { code: contentTag, from: "tag" };
  /**
   * A place tag is held back rather than returned: it has to lose to anything
   * the text itself says, and it may only speak when nothing else can. Reading
   * it here is what threw a Filipino singer's English covers out of the English
   * room on the strength of "#pinoy" — and holding it back too far is what let
   * her Tagalog songs back in.
   */
  const placeTag = tags.length ? tagVote(tags, PLACE_WORDS) : null;

  /**
   * A caption that names its own language beats everything left, because it is
   * the creator telling us directly.
   */
  const claim = claimedLanguage(caption) ?? claimedLanguage(audio);
  if (claim) return { code: claim, from: "claim" };

  /**
   * Romanised words. The audio title is read first and separately: it is the
   * creator's own label for the song and is not buried among hashtags, emoji
   * and credits the way a caption is.
   */
  const fromAudio = romanisedLanguage(audio);
  if (fromAudio) return { code: fromAudio.code, from: "audio" };

  /**
   * The provider's language tag, last among the things that describe content.
   *
   * It is deliberately not first any more. Measured against the video, it is a
   * reading of the *caption*, not of the reel: two K-drama clip pages with
   * English captions came back `en` while the audio was Hindi, and a
   * Hindi-dubbed clip captioned in English is exactly what leaked. The tag is
   * still worth reading — plenty of French or Portuguese captions are Latin
   * script and nothing else here can place them — but it is filed with the
   * caption, not with the song.
   */
  if (provider) return { code: provider, from: "provider" };

  const fromCaption = romanisedLanguage(caption);
  if (fromCaption) return { code: fromCaption.code, from: "romanised" };
  /**
   * Last, and only with two hits: sung lyrics written in Latin letters because
   * whisper heard the words but not the script ("nidhra poru emo"). One word is
   * a guess, two agreeing words are a language.
   */
  const fromSpoken = spoken ? romanisedLanguage(spoken, 2) : null;
  if (fromSpoken) return { code: fromSpoken.code, from: "sung" };

  if (placeTag) return { code: placeTag, from: "place" };

  if (caption && hasForeignWords(caption)) {
    // Not English, but which language is a guess. "other" says just that.
    return { code: "other", from: "words" };
  }
  if (caption && looksEnglish(caption)) return { code: "en", from: "english" };
  return { code: null, from: null };
}

export interface CommentReading {
  code: string;
  /** how many comments carried explicit evidence */
  labelled: number;
  /**
   * How many comments nothing could place — Latin letters, no foreign marker,
   * no English function word either ("obsessed", "goosebumps", "so good").
   *
   * This count exists because the two sides of the evidence are not symmetric.
   * A Hindi or Telugu comment labels itself with markers that a stop-word
   * lexicon catches easily; an English one is often a single word, and single
   * English words carry no function word to match. Counting only strict labels
   * therefore made every English comment section look emptier than it is, which
   * quietly biased the gate towards convicting English reels — a real English
   * cover on a Telugu account could not reach the audience bar it needed.
   */
  unmarked: number;
  /** how many comments carried a positive non-English marker */
  foreign: number;
  /** how many of those agreed with `code` */
  agreeing: number;
  /** share of labelled comments that agreed */
  share: number;
  /**
   * The reading is English. English is the lingua franca of Instagram
   * comments — a Telugu reel can have a page of English ones — so it is allowed
   * to confirm an English judgement but never to pull a post out of another
   * room on its own.
   */
  english: boolean;
}

/**
 * What language the audience writes in.
 *
 * The comments are the only place the audience speaks for itself. Under a Telugu
 * reel they are Telugu typed in Latin letters ("Relatives nidhra poru emo"),
 * which no script test sees; under an English cover they are English. That
 * makes them useful in two directions: they can confirm a post whose caption is
 * silent, and they can expose a post that is in the wrong room even though its
 * caption was written in English.
 *
 * Read strictly — three labelled comments at minimum, six in ten agreeing —
 * because comments are short and one "🔥" is not a language.
 */
type CommentList = LangInput["comments"] | LangInput["topComments"] | number | undefined | null;

export function commentsLanguage(...lists: CommentList[]): CommentReading | null {
  /**
   * A `comments` field is a count on search results and a list on a post bought
   * through the deep pass. Both arrive here, so a bare number is skipped rather
   * than counted as evidence.
   */
  const comments: { text?: string | null }[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (typeof c === "string") comments.push({ text: c });
      else if (c && typeof c === "object") comments.push(c as { text?: string | null });
    }
  }
  if (!comments.length) return null;
  const votes = new Map<string, number>();
  let labelled = 0;
  let unmarked = 0;
  let foreign = 0;
  for (const c of comments) {
    const text = c.text ?? "";
    if (!text || text.length < 4) continue;
    const read = readLanguage({ caption: text });
    if (read.code && read.code !== "en" && read.code !== "other") foreign += 1;
    if (!read.code || !read.from) {
      /**
       * Nothing said what this is. Latin letters and no foreign marker is not
       * proof of English — it is the absence of evidence — so it is counted
       * apart and only used to answer "is there any foreign comment here".
       */
      if (isUnmarkedLatin(text)) unmarked += 1;
      continue;
    }
    // "other" is a shrug, not a language: it says the comment is not English
    // without saying what it is, so it cannot vote for a room.
    if (read.from === "words") continue;
    // An English reading over a comment that carries a foreign marker is the
    // weakest reading there is, and it cannot vote for the English room.
    if (read.code === "en" && hasForeignWords(text)) continue;
    labelled += 1;
    votes.set(read.code, (votes.get(read.code) ?? 0) + 1);
  }

  /**
   * English is decided on a wider sample than any other language: a comment
   * section with four Latin comments and not one foreign marker is an English
   * audience, even when half of them are a single word. Every other language
   * keeps the strict bar, because a Latin comment that is not obviously
   * English is far more likely to be Spanish, Turkish or romanised Telugu than
   * English.
   */
  let best: string | null = null;
  let bestN = 0;
  for (const [code, n] of votes) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  if (!best) return null;

  /**
   * English, on the wider sample: the comments that could be placed said
   * English, and nothing placed itself anywhere else. The unplaced ones are
   * then English by elimination — which is only true when no other language
   * has a voice. Three Hindi comments and five unplaced ones is a Hindi
   * audience, not an English one, so a competing language of any weight sends
   * the reading back through the strict path.
   */
  const englishN = votes.get("en") ?? 0;
  const otherN = labelled - englishN;
  if (englishN >= 2 && otherN <= 1 && unmarked > 0) {
    const clean = englishN + unmarked;
    return { code: "en", labelled: clean, agreeing: clean, share: 1, english: true, unmarked, foreign };
  }
  if (labelled < 3) return null;
  const share = bestN / labelled;
  if (share < 0.6) return null;
  return { code: best, labelled, agreeing: bestN, share, english: best === "en", unmarked, foreign };
}

/** Latin letters, at least one real word, no foreign marker: placeable as neither. */
function isUnmarkedLatin(text: string): boolean {
  const t = text.replace(/https?:\/\/\S+/g, " ").replace(/[#@][\w.]+/gu, " ").trim();
  if (!t) return false;
  // Any non-Latin script at all means the comment did say something.
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u.test(t)) return false;
  if (!/\p{Script=Latin}{3,}/u.test(t)) return false;
  return !hasForeignWords(t);
}

/** The language named in a niche phrase, e.g. "english music covers" → en. */
export function languageInQuery(query: string): { code: string; word: string } | null {
  const lower = query.toLowerCase();
  for (const [code, words] of Object.entries(NAMES)) {
    for (const w of words) {
      const re = new RegExp(`(^|[^a-z])${w}([^a-z]|$)`);
      const m = lower.match(re);
      if (m) return { code, word: m[0].replace(/[^a-z]/g, "") };
    }
  }
  return null;
}

/**
 * The room's language when the search phrase does not name one: whatever the
 * creator actually posts in. Their own account is the one sample we know is
 * the right room, so it sets the language for everyone else.
 */
export function dominantLanguage(reels: LangInput[]): string | null {
  /**
   * Weighted votes: a post that states its language counts once, a post whose
   * comments state it counts half. The audience should be able to tip the
   * balance for a creator who writes English captions over Telugu songs, but it
   * must not outvote the content itself.
   */
  const votes = new Map<string, number>();
  const add = (code: string, weight: number) =>
    votes.set(code, (votes.get(code) ?? 0) + weight);
  for (const r of reels) {
    const { code, from } = readLanguage(r);
    if (code && code !== "other" && from !== "words") add(code, 1);
    const c = commentsLanguage(r.comments, r.topComments);
    if (c) add(c.code, 0.5);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [code, n] of votes) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  return best;
}

/**
 * Which language the room is, and — just as important — how we know.
 *
 * A phrase that names a language is a constraint: "english music covers" means
 * English, and a Telugu film song under it is wrong however many views it has.
 * A phrase that names none ("music covers in india", "daily vlogs india") is
 * not a constraint, and inventing one is how a pull gets quietly narrowed to
 * whatever leaked in most: the earlier code took the majority language of the
 * raw, unfiltered pull as the room's language, so a search that came back 60%
 * Telugu became a Telugu room and every English reel was thrown out of it. The
 * gate could never report a mixed pull, because it had already decided that the
 * biggest pile was the answer.
 *
 * So the fallbacks are evidence, not a plurality, and they are ordered so the
 * least contaminated sample speaks first:
 *
 *   1. query — the phrase names a language. Always used, always wins.
 *   2. own   — the creator's own posts, when we were given a handle. Their
 *              account is the one sample that is definitely the right room, and
 *              it is never the thing being measured, so it cannot bias itself.
 *   3. pull  — the search itself, only when it is clearly one language: four
 *              labelled reels at minimum and six in ten agreeing. Half the
 *              posts silent is not a majority, it is silence.
 *   4. none  — no constraint. Everything is kept, and the page says the pull
 *              was mixed instead of pretending it was one room.
 *
 * "Labelled" means explicit evidence only (provider, script, hashtag, romanised
 * word, claim) — an English caption is the exact thing that lies on a cover, so
 * it never votes for the room's language.
 */
export interface RoomLanguage {
  code: string | null;
  basis: "query" | "own" | "pull" | "none";
  /** the word in the phrase that named it, when the phrase named one */
  word?: string;
  /** how many reels in the deciding sample carried explicit language evidence */
  labelled: number;
  /** how many of those agreed */
  share: number;
}

/** Six in ten agreeing is a majority; five in ten is a coin toss. */
const ROOM_MIN_SHARE = 0.6;
/** An account needs three labelled posts before it can speak for itself. */
const ROOM_MIN_OWN = 3;
/** A whole pull needs four, since a search returns one reel per account. */
const ROOM_MIN_PULL = 4;

function hardLanguageShare(reels: LangInput[]): {
  code: string | null;
  labelled: number;
  /** how many posts agreed with `code` */
  top: number;
  /** agreeing share of the labelled posts */
  share: number;
} {
  const counts = new Map<string, number>();
  let labelled = 0;
  for (const r of reels) {
    const code = explicitLanguage(r);
    if (!code) continue;
    labelled += 1;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let code: string | null = null;
  let n = 0;
  for (const [c, k] of counts) {
    if (k > n) {
      code = c;
      n = k;
    }
  }
  return { code, labelled, top: n, share: labelled ? n / labelled : 0 };
}

export function roomLanguage(
  query: string,
  opts: { own?: LangInput[]; pull?: LangInput[] } = {},
): RoomLanguage {
  const named = languageInQuery(query);
  if (named) {
    return { code: named.code, basis: "query", word: named.word, labelled: 0, share: 1 };
  }
  const own = opts.own ?? [];
  const ownRead = own.length ? hardLanguageShare(own) : { code: null, labelled: 0, top: 0, share: 0 };
  if (ownRead.code && ownRead.labelled >= ROOM_MIN_OWN && ownRead.share >= ROOM_MIN_SHARE) {
    return { code: ownRead.code, basis: "own", labelled: ownRead.labelled, share: ownRead.share };
  }
  const pull = opts.pull ?? [];
  const pullRead = pull.length ? hardLanguageShare(pull) : { code: null, labelled: 0, top: 0, share: 0 };
  /**
   * The pull may only speak for the room when it decided most of the pull, not
   * merely most of the posts that happened to say something.
   *
   * "Six Telugu reels and six unspecified English ones" is a mixed pull: the
   * six that said nothing are a gap, and reading the gap as agreement with the
   * six that spoke is how a search for covers in a market with no language in
   * the phrase gets quietly narrowed to whatever leaked in most. The phrase
   * named no language, so there is no constraint to enforce — the room stays
   * open and the page says the pull was mixed, which is the truth.
   */
  if (
    pullRead.code &&
    pullRead.labelled >= ROOM_MIN_PULL &&
    pullRead.share >= ROOM_MIN_SHARE &&
    pullRead.top / Math.max(1, pull.length) >= ROOM_MIN_SHARE
  ) {
    return { code: pullRead.code, basis: "pull", labelled: pullRead.labelled, share: pullRead.share };
  }
  return { code: null, basis: "none", labelled: pullRead.labelled, share: pullRead.share };
}

/**
 * The language an account posts in, judged only on explicit evidence — the
 * provider's tag, the script, or a language hashtag — never on an English
 * caption, because Indian creators write English captions over Telugu songs.
 *
 * Needs at least two labelled posts and half the account's reels to agree.
 * One stray #hindisongs on an English covers page must not relabel the account.
 */
export function accountLanguage(reels: LangInput[]): string | null {
  const votes = new Map<string, number>();
  const audience = new Map<string, number>();
  for (const r of reels) {
    const { code, from } = readLanguage(r);
    if (code && from && from !== "english" && from !== "words") {
      votes.set(code, (votes.get(code) ?? 0) + 1);
    }
    // The comments under an account's reels are their audience, which is the
    // same room an account belongs to — weaker than the post, so counted apart.
    const c = commentsLanguage(r.comments, r.topComments);
    if (c) audience.set(c.code, (audience.get(c.code) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [code, n] of votes) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  if (!best) {
    /**
     * No post labels itself. An account whose comments speak one language
     * throughout is still legible — this is the case the per-post tests cannot
     * see, an unlabelled account posting into one specific audience.
     */
    let top: string | null = null;
    let topN = 0;
    for (const [code, n] of audience) {
      if (n > topN) {
        top = code;
        topN = n;
      }
    }
    return top && topN >= 2 && topN / Math.max(1, reels.length) >= 0.5 ? top : null;
  }
  /**
   * One labelled post is normally not enough — a single #hindisongs tag on an
   * English covers page must not relabel the whole account. It is enough when
   * the comments agree, because then two independent things point the same way.
   */
  if (bestN < 2) {
    const agreed = audience.get(best) ?? 0;
    if (agreed < 2) return null;
    return best;
  }
  if (bestN / Math.max(1, reels.length) < 0.4) return null;
  return best;
}

export interface AccountLangProfile {
  /**
   * true = judge this account's posts one by one, because it genuinely works in
   * both languages. false = it has one language, and posts that look like the
   * room but are not are its own content.
   */
  mixed: boolean;
  /** the account's language, when it can be read */
  lang: string | null;
  /**
   * How solidly that language dominates, so a tag-only English post can be
   * overridden on an account that is 11/12 Japanese — but not on one that
   * really does cover in two languages.
   */
  dominance: { code: string; share: number; n: number } | null;
}

/**
 * What kind of account is this, across all the posts we hold for it?
 *
 * The first version asked only "does it have *any* post in the wanted
 * language?" — and one English hashtag on a Japanese tag-spam account was
 * enough to declare it mixed, keep its twelve posts in the pool and let eleven
 * of them through as "unknown". A share, not a presence, is the question.
 *
 * The second version measured that share against the account's *labelled*
 * posts, which convicted the wrong people: a Filipino creator who covers
 * English songs and tags only her Tagalog ones came out 100% Tagalog and lost
 * every English cover she has. The share now runs over **all** the account's
 * posts, because the question is "is this account committed to another
 * language?" — and an account that labels three posts out of twelve has not
 * answered it. Only an account that labels half its feed in one language is
 * convicted, and only then are its unlabelled posts treated as that language.
 */
export function accountProfile(reels: LangInput[], want: string | null): AccountLangProfile {
  const labelled: string[] = [];
  for (const r of reels) {
    const code = explicitLanguage(r);
    if (code) labelled.push(code);
  }
  if (!labelled.length) {
    return { mixed: false, lang: accountLanguage(reels), dominance: null };
  }

  const counts = new Map<string, number>();
  for (const c of labelled) counts.set(c, (counts.get(c) ?? 0) + 1);
  let top: string | null = null;
  let topN = 0;
  for (const [code, k] of counts) {
    if (k > topN) {
      top = code;
      topN = k;
    }
  }
  const posts = Math.max(1, reels.length);
  /**
   * Conviction: the language has to be the account's own habit — three labelled
   * posts at least, and half of everything it posts. Below that the account is
   * mixed or unclear, its unlabelled posts stay in the pool, and each of them
   * is decided on its own evidence.
   */
  const convicted = top && topN >= 3 && topN / posts >= 0.5 ? top : null;
  /**
   * A creator who visibly works in both languages — two labelled posts in the
   * wanted one, and a real share of their labelled output — is never convicted,
   * however lopsided the count. This is the "covers English songs and Tagalog
   * songs" case: judge the posts, not the person.
   */
  const wantedN = want ? (counts.get(want) ?? 0) : 0;
  const twoWay = Boolean(want && wantedN >= 2 && wantedN / labelled.length >= 0.4);
  return {
    mixed: twoWay || !convicted,
    lang: convicted ?? accountLanguage(reels),
    dominance: convicted ? { code: convicted, share: topN / posts, n: topN } : null,
  };
}

/**
 * Explicit label only — provider tag, script or language hashtag. Used to spot
 * a mixed account: one that tags both English and Hindi is judged post by post,
 * never relabelled wholesale.
 */
export function explicitLanguage(post: LangInput): string | null {
  const { code, from } = readLanguage(post);
  if (!code || !from || from === "english" || from === "words" || from === "place") return null;
  return code;
}

export interface LangVerdict {
  keep: boolean;
  /** short reason, for logs and audits: "tag:te", "provider:tr", "ok" */
  why: string;
}

/**
 * A reel the account contradicts but nothing in the reel itself does.
 *
 * `suspect:` is a third answer between keep and drop, and it exists because
 * "this account posts in Telugu" and "this reel is Telugu" are different
 * claims. The first is an inference from the account; the second is a fact
 * about the reel. A Telugu cover singer's Telugu film song captioned in
 * English should go, and a bilingual artist's English single should stay — and
 * the caption cannot tell those two apart, because both are English words over
 * a reel.
 *
 * So the gate stops pretending to know. A suspect reel is *kept* for long
 * enough to reach the second witness — the video, then the comments — and if
 * that witness says another language it is dropped on proof, if it says the
 * room's language it is kept on proof. Only when no witness can speak does the
 * account's prior decide, and then it decides by dropping: `shape()` treats a
 * verdict that is still suspect at the end as a drop, because the only thing
 * left pointing anywhere points out of the room.
 */
export function isSuspect(why: string): boolean {
  return why.startsWith("suspect:");
}

/** The language a suspect verdict names, for the audit line. */
export function suspectLanguage(why: string): string | null {
  return isSuspect(why) ? why.slice("suspect:".length) || null : null;
}

/**
 * Does this post belong to a room in `want`?
 *
 * Contradiction only: a post is dropped when the provider says another
 * language, when its script cannot be `want`, or when its own tags place it
 * elsewhere. Silence is kept — an unlabelled reel is a gap in the evidence, not
 * a wrong-language post.
 */
export function inLanguage(
  post: LangInput,
  want: string | null,
  account?: string | AccountLangProfile | null,
): LangVerdict {
  if (!want) return { keep: true, why: "no-constraint" };
  const profile: AccountLangProfile =
    typeof account === "string"
      ? { mixed: false, lang: account, dominance: null }
      : (account ?? { mixed: false, lang: null, dominance: null });
  const accountLang = profile.lang;
  const { code, from } = readLanguage(post);
  const said = commentsLanguage(post.comments, post.topComments);

  /**
   * The post itself proves nothing — an English caption, or no caption at all.
   * If the account's other reels are explicitly in another language, this post
   * is that account's content, not the room's: "barbaad - saiyaara" is a Hindi
   * film song with an English caption and no tag, and it was being counted as
   * English cover evidence.
   */
  /**
   * A caption reading and a provider reading are the same evidence wearing
   * different clothes — the provider's language tag follows the caption on this
   * data — so both are "unconfirmed" when they agree with the room, and both
   * can be overruled by the account or the comment section. A provider tag that
   * says something else is still a contradiction, and still drops the reel.
   */
  const weak = !code || from === "english" || (from === "provider" && code === want);
  if (weak && accountLang && accountLang !== want) {
    /**
     * Except when the comments say otherwise. An account that normally posts
     * Telugu can still publish a real English cover, and the comments under it
     * will be English too. Two independent signals beating one is a keep.
     */
    /**
     * An English comment section is weak evidence — plenty of Telugu reels have
     * one — so it takes a clear supermajority to rescue a post the account
     * contradicts, while any other language needs only the normal bar.
     */
    const emphatic = !said?.english || (said.share >= 0.75 && said.labelled >= 4);
    if (said && said.code === want && emphatic) {
      return { keep: true, why: `comments:${want}` };
    }
    /**
     * Not a drop: the account is the only thing pointing anywhere, and an
     * account is a person's habit, not this reel's language. See `isSuspect`.
     */
    return { keep: true, why: `suspect:${accountLang}` };
  }
  if (!code) {
    /**
     * Nothing on the post, and the account is unknown. The comments are the
     * last witness, and they are only trusted when they are emphatic: three
     * labelled comments, seven in ten agreeing, on another language entirely.
     * This is what catches a Hindi song behind an English caption with no tags.
     */
    if (said && !said.english && said.code !== want && said.share >= 0.7 && said.labelled >= 3) {
      return { keep: false, why: `comments:${said.code}` };
    }
    return { keep: true, why: "unknown" };
  }

  // "other" is the vague non-English reading. It contradicts English, and for
  // any other target it is simply not evidence.
  if (code === "other") {
    return want === "en" ? { keep: false, why: "words:other" } : { keep: true, why: "unknown" };
  }
  /**
   * A tag is the weakest kind of positive evidence: it is metadata the creator
   * types, not the content. On an account that is 11 posts Japanese and one post
   * tagged #englishsongs, the tag is spam and the account knows better.
   */
  if (
    from === "tag" &&
    code === want &&
    accountLang &&
    accountLang !== want &&
    profile.dominance?.code === accountLang &&
    profile.dominance.n >= 3 &&
    profile.dominance.share >= 0.8
  ) {
    /**
     * Also suspect rather than dropped: a tag that says the room's language on
     * an account that says another is a conflict between two pieces of the
     * same weak kind, and the reel itself is the only thing that can settle it.
     */
    return { keep: true, why: `suspect:${accountLang}` };
  }

  /**
   * An English caption is the weakest positive reading there is: Indian
   * creators write English captions over Telugu and Hindi songs, so it says more
   * about the creator than about the reel. It cannot drop a post from a
   * non-English room, and it only counts as English when the audience under the
   * reel is not emphatically writing something else.
   */
  if (from === "english") {
    if (want !== "en") return { keep: true, why: "english-caption-unknown" };
    /**
     * An English caption is the weakest positive reading there is, so an English
     * audience cannot confirm it and a non-English one can convict it — at the
     * same bar as a post with no caption at all (three labelled comments, seven
     * in ten agreeing). It used to need four at three in four, which meant a
     * Hindi film song with an English caption and three Hindi comments survived
     * the harshest branch in the file on a technicality.
     */
    if (said && !said.english && said.code !== "en" && said.share >= 0.7 && said.labelled >= 3) {
      return { keep: false, why: `comments:${said.code}` };
    }
    return { keep: true, why: "ok:english" };
  }
  /**
   * Where the creator is from is not what the reel is. "#pinoy" on an English
   * covers page is a home country, not a language, so it can confirm a match
   * but never throw a reel out of a room on its own.
   */
  if (from === "place") {
    return code === want
      ? { keep: true, why: "ok:place" }
      : { keep: true, why: "unknown" };
  }
  if (code === want) return { keep: true, why: `ok:${from}` };
  return { keep: false, why: `${from}:${code}` };
}
