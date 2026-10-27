/**
 * Romanised languages: the hole the script test cannot see.
 *
 * A Telugu caption is easy — U+0C00 gives it away. The reels that actually
 * leaked into an English-covers pull were written in Latin letters: "barbaad -
 * saiyaara" (Hindi film song), "Relatives nidhra poru emo" (Telugu), "aşk
 * kalbim" (Turkish). Same alphabet as English, different language, and nothing
 * in the pipeline was looking at the words themselves.
 *
 * So this is a stop-word lexicon, the way every language detector works, but
 * built for Instagram instead of prose: song titles, one-line captions, and
 * comments typed fast without diacritics.
 *
 * Two tiers, because precision matters more than coverage here — a false
 * "this is Telugu" throws away a real English cover:
 *
 *   STRONG  words that essentially never appear in English text. One is enough.
 *   WEAK    function words. Two distinct ones are needed, and English evidence
 *           in the same text has to be thinner than the foreign evidence.
 *
 * Deliberately absent: short words that collide with English or with names
 * ("ra", "lo", "anna", "hi", "do", "is", "to", "no", "me"). A detector that
 * fires on those would delete half of every English pull.
 */

/** Words so characteristic that a single one settles it. */
export const STRONG: Record<string, string[]> = {
  // Telugu — read off real comments under Telugu reels ("Relatives nidhra poru
  // emo", "Ee combo ni aapedhevaru", "Epudu ila odd ga behave chestune untundi").
  te: [
    "emo", "akka", "chala", "chalaa", "kadha", "ledu", "ledhu", "aite",
    "bhale", "chesadu", "chesi", "chesa", "chestunna", "chestundu", "vachindi",
    "vachadu", "aapedhevaru", "nidhra", "untundi", "untadu", "untav", "ayyipoyindi",
    "telugu", "tollywood", "gurinchi", "endhuku", "enduku", "emiti", "enti",
    // Telugu film-song titles, the same way: "chuttamalle", "maate vinadhuga".
    "samajavaragamana", "chuttamalle", "buttabomma", "peelings", "ninnu",
    "vennelave", "ramulo", "aakasam", "tholi", "maate", "vinadhuga", "nammaka",
    "tappani", "yaalalo", "kalyani", "padipoya", "naatu", "sirivennela", "prema",
  ],
  // Hindi/Hinglish — verbs and particles that Hindi typing produces constantly.
  hi: [
    "jayega", "jayegi", "jaega", "karega", "karegi", "karta", "karti", "karna",
    "karne", "karo", "raha", "rahi", "rahe", "sakta", "sakte", "nahi", "nahin",
    "hoga", "hogi", "hota", "wala", "wali", "wale", "bahut", "bohot", "sirf",
    "abhi", "kaise", "kaisa", "kaisi", "mujhe", "tumhe", "tumhare", "tumhara",
    "humko", "apna", "apni", "jaise", "waisa", "matlab", "bilkul", "zaroor",
    "zindagi", "pyaar", "pyar", "dil", "yaar", "dost", "acha", "accha", "theek",
    "thik", "kyunki", "lekin", "phir", "bhai", "bhaiya", "didi", "pagal",
    "bollywood", "hindustani", "desi", "sahi", "mast", "bindaas",
    /**
     * Hindi film-song titles are written in Latin letters and are the single
     * most reliable hint that a caption like "Kesariya 🌸 #cover" is not an
     * English cover. Whole-word matches only — these are words, not a hunt for
     * substrings inside English ones.
     */
    "kesariya", "saiyaara", "saiyaan", "tumhiho", "channa", "ishq", "mohabbat",
    "deewana", "deewane", "deewani", "jaana", "jaanam", "sajna", "sajan",
    "piya", "hawayein", "saanson", "dhadkan", "armaans", "barsaat", "raabta",
    "humdum", "sanam", "mahiya", "rang", "naina", "ankhon", "khwab", "jhoom",
    "mehndi", "shiddat", "baarishein", "chand", "raat", "yaara", "yaar",
  ],
  // Tamil
  ta: [
    "romba", "sollu", "solra", "venum", "vendam", "irukku", "iruku", "thaan",
    "kadhal", "machan", "machi", "vanakkam", "epdi", "ipdi", "enna", "ennada",
    "pothu", "sema", "vera", "levelu", "kollywood", "tamizh", "tamil",
  ],
  // Kannada
  kn: [
    "nodri", "hegidiya", "chennagide", "guru", "swalpa", "illa", "kannada",
    "sandalwood", "namaskara", "yenappa", "yaake", "hogu", "beku", "bekilla",
  ],
  // Malayalam
  ml: [
    "entha", "nalla", "kollam", "pakshe", "undu", "illaathe", "malayalam",
    "mollywood", "sukham", "chechi", "chettan", "ippo", "pinne",
  ],
  // Punjabi
  pa: ["sanu", "tenu", "kiddan", "bahut", "pyar", "soni", "kudi", "munda", "punjabi", "balle"],

  // Turkish — "aşk kalbim", "seni seviyorum", "çok güzel"
  tr: [
    "seviyorum", "kalbim", "kalbimi", "gibisin", "değil", "şarkı", "sarki",
    "aşk", "ask", "hayat", "güzel", "guzel", "beni", "seni", "bana", "sana",
    "için", "icin", "yok", "türkçe", "turkce", "türkiye", "turkish",
  ],
  // Spanish — "corazón", "te quiero", "mi amor"
  es: [
    "corazón", "corazon", "quiero", "quieres", "sueño", "sueños", "siempre",
    "nunca", "porque", "cuando", "también", "tambien", "mucho", "muchas",
    "bailar", "canción", "cancion", "vida", "tengo", "eres", "estás", "estas",
    "corridos", "ranchera", "reggaeton", "español", "espanol", "latino",
  ],
  // Portuguese
  pt: [
    "não", "nao", "você", "voce", "muito", "muita", "isso", "isto", "aqui",
    "também", "tambem", "então", "entao", "meu", "minha", "coração", "coracao",
    "saudade", "garota", "menina", "beijo", "obrigado", "obrigada", "sertanejo",
  ],
  // Indonesian / Malay
  id: [
    "banget", "gimana", "caranya", "untuk", "dengan", "adalah", "tidak",
    "sudah", "belum", "sangat", "karena", "mereka", "kita", "aku", "kamu",
    "sayang", "cinta", "lagu", "senang", "sekali", "orang",
  ],
  // Korean, romanised
  ko: ["saranghae", "sarang", "oppa", "unnie", "noona", "hyung", "gomawo", "jinjja", "daebak", "aigoo", "hwaiting", "kpop"],
  // Japanese, romanised
  ja: ["kawaii", "sugoi", "arigatou", "konnichiwa", "kudasai", "yabai", "senpai", "watashi", "desu", "jpop"],
  // Arabic, romanised
  ar: ["habibi", "habibti", "yalla", "inshallah", "mashallah", "wallah", "khalas", "sabah", "ukhti", "akhi"],
  // Russian, transliterated
  ru: ["privet", "spasibo", "krasivaya", "lyubov", "moya", "tvoya", "ochen", "horosho", "khorosho", "davai"],
  // Vietnamese
  vi: ["khong", "duoc", "nguoi", "yeu", "nhung", "rat", "cua", "minh", "chung"],
  /**
   * Tagalog / Filipino — OPM. This is the leak that survived every other rule:
   * the script is Latin, the tags are often empty, and the caption is English,
   * so "iririsk ang lahat by kuya bruno mars" read as an English cover of an
   * English song. "ang", "mga", "yung", "talaga" are decisive in a caption and
   * do not occur in English; the two-letter particles ("at", "sa", "na") are
   * left out on purpose — "at" alone would delete half of every English pull.
   */
  tl: [
    "ang", "mga", "ako", "ikaw", "siya", "kami", "kayo", "sila", "natin",
    "ninyo", "niya", "kanila", "mahal", "salamat", "kasi", "dahil", "kapag",
    "yung", "iyon", "ito", "talaga", "grabe", "naman", "lahat", "opo", "kuya",
    "ate", "puso", "buhay", "ganda", "maganda", "pagibig", "pag-ibig",
    "kumanta", "kantahan", "awit", "opm", "tagalog", "filipino", "pinoy",
    "pilipinas", "philippines", "kundiman", "harana", "tula", "kilig",
  ],
  /** Persian / Farsi, romanised. Script covers most of it; this is the rest. */
  fa: [
    "ashegh", "eshgh", "delam", "delbar", "kheyli", "khaili", "ziba",
    "ghashang", "farsi", "persian", "irani", "khodahafez", "janam", "rooz",
  ],
};

/**
 * Function words. Weak on their own — German "mein" and Hindi "mein" collide,
 * Spanish "tu" and French "tu" collide — so two distinct ones are required and
 * they only decide between languages, never English vs not.
 */
export const WEAK: Record<string, string[]> = {
  hi: ["hai", "hain", "ka", "ki", "ke", "ko", "se", "mein", "aur", "bhi", "kuch", "ek", "aa", "gaya", "gayi", "kya", "kyun"],
  te: ["lo", "ra", "ee", "ni", "manchi", "baga", "chudu", "kuda", "mari", "ala", "ila"],
  ta: ["da", "di", "na", "nee", "oru", "illa", "aama", "nalla"],
  tr: ["sen", "ben", "bir", "bu", "ve", "da", "de"],
  es: ["que", "por", "para", "como", "mi", "te", "pero", "todo", "nada", "con", "sin", "muy", "yo", "tu", "esta", "este", "amor", "más", "mas"],
  pt: ["para", "como", "mais", "dos", "das", "uma", "com", "por", "em", "amor"],
  id: ["yang", "dan", "ini", "itu", "bisa", "lebih", "paling", "anda", "kami"],
  fr: ["je", "nous", "vous", "est", "et", "pour", "avec", "dans", "mon", "ma", "pas", "plus", "tout", "comme", "amour", "toujours", "jamais", "chanson", "oui"],
  de: ["ich", "nicht", "und", "ist", "mit", "für", "auf", "mein", "meine", "sehr", "auch", "aber", "wie", "wir", "liebe", "herz", "immer"],
  it: ["io", "non", "che", "per", "con", "una", "sono", "molto", "amore", "cuore", "sempre", "mai", "canzone", "bella", "bello", "ciao", "anche", "questo"],
  // Tagalog particles. Two of them decide between Tagalog and English, which is
  // the only thing WEAK is allowed to do. "po" and "ba" are excluded: "PO box"
  // and "ba dum tss" are English sentences.
  tl: ["lang", "para", "yung", "naman", "kasi", "dahil", "talaga", "grabe", "ng", "sa"],
};

/**
 * Words for the person being spoken to.
 *
 * "yaar this song is so good, had to cover it" is an English caption with one
 * Hindi vocative in it, and Indian creators write like that constantly. A
 * vocative is not evidence of the language of the sentence around it — it is
 * evidence of who the creator is talking to — so these count as corroboration
 * and never as a decisive hit. Without this split, "yaar" alone threw a real
 * English cover out of the English room.
 */
export const VOCATIVE: Record<string, string[]> = {
  hi: ["yaar", "bhai", "bhaiya", "behen", "didi", "dost", "mitra"],
  te: ["akka", "anna", "ra", "bro"],
  ta: ["machan", "machi", "thala"],
  ml: ["chechi", "chettan"],
  kn: ["guru", "anna"],
  pa: ["veer"],
  tl: ["kuya", "ate", "bes"],
};

/**
 * Audio names that carry no information. Instagram writes these in the
 * account's own language, so "Son original" is French UI noise, not French
 * content — reading it as evidence put a language vote on thousands of reels.
 */
const NOISE_AUDIO = new Set([
  "original audio", "original sound", "original soundtrack", "originalaudio",
  "son original", "audio original", "sons original", "audio originale",
  "оригинальный звук", "оригинальный аудио", "suara asli", "som original",
  "sonido original", "原声", "オリジナル楽曲", "원본 오디오", "صوت أصلي",
  "orijinal ses", "âm thanh gốc", "trending audio", "instagram audio",
]);

export function isNoiseAudio(name: string | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!n) return true;
  if (NOISE_AUDIO.has(n)) return true;
  // "Original audio - artist" and similar wrappers
  return /\boriginal (audio|sound)\b/.test(n) && n.length < 40;
}

/** Latin-script words only, lowercased, diacritics kept for exact matching. */
export function latinWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\w.]+/g, " ")
    // Split on anything that is not a letter — whitespace included. Keeping \s
    // inside this class made the separator swallow the spaces and return the
    // whole caption as one "word", which is how every marker went unmatched.
    .split(/[^a-zà-ÿ\u0100-\u024F']+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 1);
}

/** Accent-stripped copy, so "corazón" also matches "corazon" and vice versa. */
function fold(w: string): string {
  return w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const STRONG_SETS = new Map<string, Set<string>>();
for (const [code, list] of Object.entries(STRONG)) {
  const set = new Set<string>();
  for (const w of list) {
    set.add(w);
    set.add(fold(w));
  }
  STRONG_SETS.set(code, set);
}

const WEAK_SETS = new Map<string, Set<string>>();
for (const [code, list] of Object.entries(WEAK)) {
  const set = new Set<string>();
  for (const w of list) {
    set.add(w);
    set.add(fold(w));
  }
  WEAK_SETS.set(code, set);
}

/** Vocatives: corroboration only, whatever their language. */
const VOCATIVE_SETS = new Map<string, Set<string>>();
for (const [code, list] of Object.entries(VOCATIVE)) {
  const set = new Set<string>();
  for (const w of list) {
    set.add(w);
    set.add(fold(w));
  }
  VOCATIVE_SETS.set(code, set);
}

export interface RomanisedReading {
  code: string;
  /** the exact words that decided it, for the audit line */
  hits: string[];
  /** how many were strong markers (decisive) vs weak (corroborating) */
  strong: number;
}

/**
 * What language is this romanised text in?
 *
 * `minStrong` is 1 for captions and comments ("emo" is already conclusive) but
 * can be raised by callers that need to be sure. Returns null whenever the
 * evidence is thin — an English sentence with the word "mas" in it is not
 * Spanish.
 */
export function romanisedLanguage(text: string, minStrong = 1): RomanisedReading | null {
  const words = latinWords(text);
  if (!words.length) return null;

  const strongHits = new Map<string, string[]>();
  const weakHits = new Map<string, string[]>();
  for (const w of words) {
    const f = fold(w);
    for (const [code, set] of STRONG_SETS) {
      if (set.has(w) || set.has(f)) {
        /**
         * A vocative decides nothing, in either direction: "yaar" in an English
         * sentence is one Hindi word doing the work of an "hey", and "yaar
         * bhai" is two of them in a sentence that is otherwise English. It is
         * skipped rather than counted as weak, because two vocatives would
         * otherwise reach the weak path's threshold and convict an English
         * cover — the vocative can still corroborate through WEAK below, where
         * words like "ra" and "da" are filed on their own merits.
         */
        if (VOCATIVE_SETS.get(code)?.has(w) || VOCATIVE_SETS.get(code)?.has(f)) continue;
        const list = strongHits.get(code) ?? [];
        if (!list.includes(w)) list.push(w);
        strongHits.set(code, list);
      }
    }
    for (const [code, set] of WEAK_SETS) {
      if (set.has(w) || set.has(f)) {
        const list = weakHits.get(code) ?? [];
        if (!list.includes(w)) list.push(w);
        weakHits.set(code, list);
      }
    }
  }

  let best: RomanisedReading | null = null;
  for (const [code, hits] of strongHits) {
    if (hits.length < minStrong) continue;
    if (!best || hits.length > best.hits.length) best = { code, hits, strong: hits.length };
  }
  if (best) return best;

  /**
   * Nothing decisive. Two distinct function words from the same language are
   * enough to name it, provided no other language scored as well — this only
   * separates "Turkish" from "Spanish", never "foreign" from "English".
   */
  const ranked = [...weakHits.entries()]
    .filter(([, hits]) => hits.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  if (!ranked.length) return null;
  const [code, hits] = ranked[0];
  if (ranked[1] && ranked[1][1].length >= hits.length && ranked[1][0] !== code) return null;
  return { code, hits, strong: 0 };
}

/** True when the text carries real evidence of a non-English language. */
export function looksRomanisedForeign(text: string): boolean {
  const r = romanisedLanguage(text);
  return Boolean(r && r.code !== "en");
}
