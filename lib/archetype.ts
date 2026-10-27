import type { RawReel, Recommendation } from "./types";

/**
 * What kind of account is this, and therefore what actually moves it?
 *
 * The plan used to give every creator the same levers — topic, opening line,
 * length — which is how a singer with a 1.9M-view cover got told to "open with a
 * flat statement". Her opening line is the song title. The lever for a singer is
 * the SONG, for a teacher it is the promise, for a cook it is the finished plate.
 *
 * So the handle is classified first, and the plan is assembled from the playbook
 * that belongs to that kind of account. Everything here is decided from the
 * account's own posts, never from a category the visitor picks.
 */

export type ArchetypeId =
  | "singer"
  | "dancer"
  | "comedian"
  | "educator"
  | "maker"
  | "fitness"
  | "beauty"
  | "travel"
  | "vlogger"
  | "family"
  | "money"
  | "gaming"
  | "tech"
  | "collector"
  | "documentary"
  | "general";

interface Signal {
  re: RegExp;
  w: number;
}

const sig = (re: RegExp, w: number): Signal => ({ re, w });

/** Words that say nothing about what an account is about. */
const EVIDENCE_STOP = new Set([
  "the", "a", "an", "my", "your", "and", "or", "of", "in", "on", "to", "for",
  "with", "this", "that", "i", "me", "it", "is", "at", "as", "by",
]);

/**
 * The languages a niche phrase is likely to name. Kept as its own list because
 * a niche's language and the account's own language have to agree: a Kannada
 * singer searched as "telugu covers" gets a cohort of Telugu songs, and the
 * first recommendation is then a song they cannot sing.
 */
export const NICHE_LANGUAGES = [
  "telugu", "kannada", "tamil", "hindi", "malayalam", "marathi", "punjabi",
  "bengali", "gujarati", "urdu", "bhojpuri",
] as const;

/**
 * Make the search phrase agree with the language the account actually posts in.
 * Only the language word is replaced — "telugu-music-covers" becomes
 * "kannada-music-covers", keeping the shape of the search the user or the
 * inference already chose.
 */
export function alignNicheLanguage(query: string, language?: string): string {
  const q = (query ?? "").trim();
  if (!q || !language) return q;
  const lang = language.toLowerCase();
  if (!NICHE_LANGUAGES.includes(lang as (typeof NICHE_LANGUAGES)[number])) return q;

  const words = q.toLowerCase().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);
  const named = words.filter((w) =>
    NICHE_LANGUAGES.includes(w as (typeof NICHE_LANGUAGES)[number]),
  );
  if (!named.length || named.includes(lang)) return q;
  return words
    .map((w) => (NICHE_LANGUAGES.includes(w as (typeof NICHE_LANGUAGES)[number]) ? lang : w))
    .join(" ");
}

/**
 * Weights are deliberately lopsided. A word that can only mean one thing
 * ("choreography", "bodybuilding") is worth 3; a word that is merely suggestive
 * ("cover", "art") is worth 0.5-1, because "cover" appears on dance reels and
 * "art" appears on nail reels.
 */
const LEXICON: Record<ArchetypeId, Signal[]> = {
  singer: [
    sig(/\bsinging\b/, 3),
    sig(/\bsingers?\b/, 3),
    sig(/\bvocal(s|ist)?\b/, 3),
    sig(/\bcoversong\b/, 3),
    sig(/\bsong ?cover\b/, 3),
    sig(/\bcover ?song\b/, 3),
    sig(/\bacoustic\b/, 2),
    sig(/\bunplugged\b/, 2),
    sig(/\bsargam\b/, 2),
    sig(/\baalap\b/, 2),
    sig(/\bmusician\b/, 3),
    sig(/\bplayback\b/, 2),
    sig(/\bguitar\b/, 2),
    sig(/\btabla\b/, 2),
    sig(/\bpiano\b/, 2),
    sig(/\bdrums?\b/, 1.5),
    sig(/\bmelody\b/, 1.5),
    sig(/\bmusic\b/, 1.5),
    sig(/\bmusiccovers?\b/, 3),
    sig(/\bhindisongs\b/, 2),
    sig(/\btelugusongs\b/, 2),
    sig(/\bkannadasongs\b/, 2),
    sig(/\btamil?songs\b/, 2),
    sig(/\bcovers\b/, 1),
    sig(/\bcover\b/, 0.5),
    sig(/\bsongs?\b/, 0.75),
    sig(/\brapp?(ing|er)?\b/, 1.5),
    sig(/\blofi\b/, 1.5),
    sig(/\bfemale version\b/, 2),
    sig(/\bmale version\b/, 2),
    sig(/\briyaz\b/, 2),
    // Transliterated lyrics and Indian-language music vocabulary. A Telugu or
    // Kannada cover often has an English-free caption, so the category arrives
    // through these words and through the hashtag, not through "song".
    sig(/\bpaata\b/, 2.5),
    sig(/\bhaadu\b/, 2.5),
    sig(/\bgaana?\b/, 2),
    sig(/\bsangeeth?\b/, 2.5),
    sig(/\bswaram\b/, 2),
    sig(/\bgeethe\b/, 2),
    sig(/\bkaraoke\b/, 2),
    sig(/\btribute\b/, 1),
    sig(/\bevergreen\b/, 1),
    sig(/\boldies\b/, 1),
    sig(/\bvocalist\b/, 2.5),
  ],
  dancer: [
    sig(/\bchoreograph(y|er)\b/, 3),
    sig(/\bdanc(ing|er)\b/, 3),
    sig(/\bdance ?cover\b/, 3),
    sig(/\bdancecover\b/, 3),
    sig(/\bhip ?hop\b/, 2),
    sig(/\bbharatanatyam\b/, 3),
    sig(/\bkathak\b/, 3),
    sig(/\bcontemporary dance\b/, 3),
    sig(/\bdance\b/, 2),
    sig(/\bmoves?\b/, 0.5),
  ],
  comedian: [
    sig(/\bstand ?up\b/, 3),
    sig(/\bcomed(y|ian)\b/, 3),
    sig(/\bskit\b/, 3),
    sig(/\bprank\b/, 2.5),
    sig(/\broast\b/, 2),
    sig(/\bjokes?\b/, 2.5),
    sig(/\bfunny\b/, 1.5),
    sig(/\bhumou?r\b/, 2),
    sig(/\bmemes?\b/, 1.5),
  ],
  educator: [
    sig(/\btutorials?\b/, 3),
    sig(/\bstep by step\b/, 2),
    sig(/\bhow to\b/, 2),
    sig(/\bteach(er|ing)?\b/, 2.5),
    sig(/\bcoaching\b/, 2.5),
    sig(/\blessons?\b/, 1.5),
    sig(/\bneet\b/, 3),
    sig(/\bjee\b/, 3),
    sig(/\bupsc\b/, 3),
    sig(/\bsyllabus\b/, 3),
    sig(/\bexams?\b/, 2),
    sig(/\bspoken english\b/, 3),
    sig(/\bvocabulary\b/, 3),
    sig(/\bgrammar\b/, 2.5),
    sig(/\bstudy\b/, 2),
    sig(/\blearn(ing)?\b/, 2),
    sig(/\btips\b/, 1),
    sig(/\bexplained\b/, 2),
    sig(/\bstudents?\b/, 1.5),
  ],
  maker: [
    sig(/\brecipe\b/, 3),
    sig(/\bcooking\b/, 3),
    sig(/\bbaking\b/, 3),
    sig(/\bkitchen\b/, 2.5),
    sig(/\bchef\b/, 2.5),
    sig(/\bcake\b/, 2),
    sig(/\bfoodie?\b/, 1.5),
    sig(/\bfood\b/, 1.5),
    sig(/\bdiy\b/, 3),
    sig(/\bcrafts?\b/, 2.5),
    sig(/\bhandmade\b/, 2.5),
    sig(/\bdrawing\b/, 2.5),
    sig(/\bpainting\b/, 2.5),
    sig(/\bsketch(ing)?\b/, 2.5),
    sig(/\bpottery\b/, 3),
    sig(/\bembroidery\b/, 3),
    sig(/\bart(work|ist)?\b/, 1.5),
    sig(/\bdesign(er)?\b/, 1.5),
    sig(/\bknit(ting)?\b/, 2),
  ],
  fitness: [
    sig(/\bworkouts?\b/, 3),
    sig(/\bbodybuilding\b/, 3),
    sig(/\bcalisthenics\b/, 3),
    sig(/\bgym\b/, 2.5),
    sig(/\bfitness\b/, 2.5),
    sig(/\bmuscles?\b/, 2),
    sig(/\btrainers?\b/, 1.5),
    sig(/\byoga\b/, 2.5),
    sig(/\bpilates\b/, 2.5),
    sig(/\bdiet\b/, 2),
    sig(/\bprotein\b/, 2),
    sig(/\bweight ?loss\b/, 2.5),
    sig(/\btransformation\b/, 1.5),
    sig(/\bbeginners?\b/, 0.75),
  ],
  beauty: [
    sig(/\bmakeup\b/, 3),
    sig(/\bskincare\b/, 3),
    sig(/\bhair ?care\b/, 2.5),
    sig(/\bnails?\b/, 2),
    sig(/\bcosmetics?\b/, 2.5),
    sig(/\bbridal\b/, 2.5),
    sig(/\bsaree\b/, 2.5),
    sig(/\boutfits?\b/, 2.5),
    sig(/\bfashion\b/, 2.5),
    sig(/\bstylist\b/, 2.5),
    sig(/\bthrift\b/, 2),
    sig(/\bstreetwear\b/, 2.5),
    sig(/\bbeauty\b/, 2),
    sig(/\bget ready with me\b/, 2),
  ],
  travel: [
    sig(/\btravel(l)?ing?\b/, 3),
    sig(/\bwanderlust\b/, 3),
    sig(/\bitinerary\b/, 3),
    sig(/\bbackpacking\b/, 3),
    sig(/\btreks?\b/, 2.5),
    sig(/\bhidden places\b/, 3),
    // "vlog" alone is not travel: a day-in-the-life creator says vlog too, and
    // that word used to drag every vlogger into the travel playbook.
    sig(/\btrip\b/, 1.5),
    sig(/\btourism\b/, 2.5),
    sig(/\bhill ?station\b/, 2.5),
    sig(/\bvacation\b/, 2),
  ],
  /**
   * The creator whose content is their own days. Their lever is the SHAPE of the
   * video — what it opens on and what it promises — not a spoken hook and not a
   * song, which is why they need their own playbook instead of the generic one.
   */
  vlogger: [
    sig(/\bvlogs?\b/, 3),
    sig(/\bvlogg(er|ing)\b/, 3),
    sig(/\bday in (my|the|a) life\b/, 3.5),
    sig(/\bweek in (my|the) life\b/, 3.5),
    sig(/\bspend the day\b/, 3),
    sig(/\bdaily (life|vlog|routine)\b/, 3),
    sig(/\bmorning routine\b/, 2.5),
    sig(/\bnight routine\b/, 2.5),
    sig(/\bevening routine\b/, 2.5),
    sig(/\broutine\b/, 1.5),
    sig(/\bcome with me\b/, 2.5),
    sig(/\blife update\b/, 2.5),
    sig(/\bthis is my life\b/, 2.5),
    sig(/\blifestyle\b/, 2.5),
    sig(/\bunfiltered\b/, 1.5),
    sig(/\bstorytime\b/, 2),
    sig(/\bmy life\b/, 1.5),
    sig(/\bwhat i (eat|do|spend)\b/, 2.5),
    sig(/\bget ready with me\b/, 1.5),
    sig(/\bhostel\b/, 1.5),
    sig(/\bcollege life\b/, 2.5),
    sig(/\bwork life\b/, 2),
  ],
  family: [
    sig(/\bmom life\b/, 3.5),
    sig(/\bdad life\b/, 3.5),
    sig(/\bparenting\b/, 3),
    sig(/\btoddler\b/, 3),
    sig(/\bnewborn\b/, 2.5),
    sig(/\bpregnan(t|cy)\b/, 2.5),
    sig(/\bhomeschool\b/, 2.5),
    sig(/\bkids?\b/, 1.5),
    sig(/\bbaby\b/, 2),
    sig(/\bfamily\b/, 2),
    sig(/\bcouple\b/, 1.5),
  ],
  money: [
    sig(/\bsips?\b/, 3),
    sig(/\bmutual funds?\b/, 3),
    sig(/\bcredit score\b/, 3),
    sig(/\binvest(ing|ment|or)?\b/, 2.5),
    sig(/\bstocks?\b/, 2.5),
    sig(/\bfinance|financial\b/, 3),
    sig(/\bsavings?\b/, 2.5),
    sig(/\bsalary\b/, 2.5),
    sig(/\bbudget(ing)?\b/, 2.5),
    sig(/\bpassive income\b/, 2.5),
    sig(/\bside hustle\b/, 2),
    sig(/\bcrypto\b/, 2),
    sig(/\btax(es)?\b/, 2),
    sig(/\bwealth\b/, 2),
    sig(/\bmoney\b/, 2.5),
    sig(/\bemi\b/, 2.5),
  ],
  gaming: [
    sig(/\bgaming\b/, 3),
    sig(/\bgameplay\b/, 3),
    sig(/\besports\b/, 3),
    sig(/\bvalorant\b/, 3),
    sig(/\bbgmi\b/, 3),
    sig(/\bfree ?fire\b/, 3),
    sig(/\bminecraft\b/, 3),
    sig(/\bgamer\b/, 3),
    sig(/\bstreamer\b/, 2.5),
    sig(/\bclutch\b/, 1.5),
  ],
  tech: [
    sig(/\bautomation\b/, 3),
    sig(/\bno ?code\b/, 3),
    sig(/\bsaas\b/, 2.5),
    sig(/\bstartups?\b/, 2),
    sig(/\bchatgpt\b/, 2.5),
    sig(/\bn8n\b/, 3),
    sig(/\bcoding\b/, 3),
    sig(/\bdeveloper\b/, 2.5),
    sig(/\bprogramming\b/, 3),
    sig(/\bcrm\b/, 2),
    sig(/\bworkflows?\b/, 2),
    sig(/\bai tools?\b/, 3),
    sig(/\bclaude\b/, 2),
    sig(/\bprompt(s|ing)?\b/, 2),
    sig(/\bagents?\b/, 1.5),
    sig(/\bapi\b/, 2),
    sig(/\bsoftware\b/, 2),
  ],
  /**
   * Watch dealers, jewellers and collectible resellers — the cohort a "rolex"
   * or "gold jewellery" search actually returns. The post is the object: the
   * piece filling the frame, the material, and the price question in comments.
   *
   * Bare "watch" is a trap ("watch till the end" is on every account in every
   * niche) and so is "collection", so the strong signals are the words that only
   * appear on a trading account: model names, metals, and "DM for price".
   */
  collector: [
    sig(/\b(timepieces?|horology|horological|wristwatch|wrist watch)\b/, 3),
    sig(
      /\b(rolex|omega|patek|tudor|cartier|audemars|hublot|breitling|seiko|panerai|vacheron|longines|tag heuer)\b/,
      3,
    ),
    sig(/\b(jewell?ery|jewell?er|fine jewelry|goldsmith)\b/, 3),
    sig(/\b(kuyumcu|alt[iı]n|bilezik)\b/, 3),
    sig(/\brel[oó]gios?\b/, 3),
    sig(/\b(necklaces?|bracelets?|pendants?|earrings?|bangles?|anklets?)\b/, 2),
    sig(
      /\b(diamonds?|18k|22k|24k|925 silver|platinum|white gold|yellow gold|rose gold)\b/,
      2,
    ),
    sig(
      /\b(for sale|available now|new arrival|just arrived|dm for price|dm for pricing|dm to order|price on request)\b/,
      2,
    ),
    sig(/\b(vvs|si1|carat|karat|consignment)\b/, 2),
    sig(/\b(collectors?|vintage)\b/, 1),
  ],

  /**
   * Wildlife, nature and cinematic-footage channels. These were the clearest
   * false "general" in the audit: an account posting tigers and oceans has an
   * obvious lever and was being told only "post on the idea behind your biggest
   * post", which is true of any account and therefore useful to none.
   */
  documentary: [
    sig(/\b(wildlife|wild life|safari|jungle|rainforest)\b/, 3),
    sig(/\b(documentary|natgeo|national geographic|bbc earth)\b/, 3),
    sig(
      /\b(tigers?|lions?|leopards?|cheetahs?|elephants?|rhinos?|bears?|wolves|whales?|sharks?|eagles?|owls?|crocodiles?|cobras?|deer|bison|gorillas?|orangutans?|penguins?|dolphins?)\b/,
      2,
    ),
    sig(/\b(species|predator|prey|migration|habitat|ecosystem)\b/, 2),
    sig(/\b(underwater|deep sea|ocean floor|coral reef|glacier|volcano|aurora)\b/, 2),
    sig(/\b(nature|wilderness|savanna|arctic|antarctic)\b/, 2),
    sig(/\b(cinematic|4k footage|8k footage|drone shot|slow motion|macro shot)\b/, 1),
  ],

  general: [],
};

/** Words that describe the container, not the subject. Never a song title. */
export const FORMAT_WORDS = new Set(
  (
    "cover covers song songs singing singer vocals vocal version female male " +
    "original remix unplugged acoustic live reel reels video audio status lyrics " +
    "lyric full new part sargam mashup medley loop trending viral fyp explore " +
    "explorepage foryou foryoupage reelsinstagram instagram youtube shorts music " +
    "musician melody soundtrack bgm theme title serial movie film"
  ).split(/\s+/),
);

/** Languages these creators post in. Script wins over tags when both exist. */
const SCRIPTS: [string, RegExp][] = [
  ["telugu", /[\u0C00-\u0C7F]/],
  ["kannada", /[\u0C80-\u0CFF]/],
  ["tamil", /[\u0B80-\u0BFF]/],
  ["malayalam", /[\u0D00-\u0D7F]/],
  ["hindi", /[\u0900-\u097F]/],
  ["bengali", /[\u0980-\u09FF]/],
  ["punjabi", /[\u0A00-\u0A7F]/],
  ["gujarati", /[\u0A80-\u0AFF]/],
];

const LANGUAGE_TAGS = [
  "telugu",
  "kannada",
  "tamil",
  "malayalam",
  "hindi",
  "marathi",
  "bengali",
  "punjabi",
  "gujarati",
  "urdu",
  "tollywood",
  "kollywood",
  "sandalwood",
  "mollywood",
  "bollywood",
];

/**
 * Hashtags are written without spaces, so `#telugumusiccovers` reached the
 * matcher as one word and no `\bcover\b`-style pattern could ever see the three
 * words inside it. On Indian music accounts that is the *primary* signal — the
 * caption is often transliterated lyrics and the hashtag carries the category —
 * so those accounts were landing in "general" and getting advice written for
 * nobody. These are the words a run-together tag is allowed to be split on.
 */
const VOCAB = (
  // industries and languages
  "tollywood kollywood sandalwood mollywood bollywood tollywood " +
  "telugu kannada tamil malayalam hindi punjabi marathi bengali gujarati urdu " +
  // music
  "music musical coversong coversongs cover singer singers singing song songs " +
  "vocals vocalist vocal melody melodies acoustic unplugged remix mashup medley " +
  "instrumental soundtrack playback composer musician artist artists recording " +
  "studio chorus verse karaoke tribute evergreen oldies original live sargam " +
  "aalap raaga swaram riyaz geethe haadu paata gana gaana sangeeth sangeet lofi " +
  // other kinds of account
  "vlog vlogs vlogger daily lifestyle routine family food foodie travel fashion " +
  "beauty makeup skincare comedy funny comic prank dance dancer fitness gym " +
  "workout bodybuilding education teacher tutor lessons tech gaming gamer " +
  "receipe recipe cooking diy craft pottery art drawing " +
  /**
   * Objects people trade, and the natural world. Both arrive as run-together
   * tags (#rolexwatches, #wildlifedocumentary, #finejewelry), and without these
   * words the splitter cannot see the two words inside — which is how a whole
   * cohort of watch dealers and wildlife channels was reading as "general".
   */
  "watch watches timepiece timepieces horology jewellery jewelry jeweller jeweler " +
  "rolex omega patek tudor cartier seiko panerai hublot breitling " +
  "wildlife safari documentary natgeo nature animal animals birds underwater " +
  "cinematic ocean reef predator necklace bracelet diamond"
).split(/\s+/);

const VOCAB_SET = new Set(VOCAB);
const VOCAB_BY_LEN = [...VOCAB].sort((a, b) => b.length - a.length);

/**
 * Split one run-together token into real words, longest known word first, so
 * `telugumusiccovers` becomes `telugu music covers`. Unknown runs between two
 * known words are kept as they are, because they are usually a name.
 */
function splitToken(tok: string): string {
  // Short tokens are already one word; splitting them only invents fragments.
  if (tok.length < 8 || VOCAB_SET.has(tok)) return tok;

  const out: string[] = [];
  let i = 0;
  while (i < tok.length) {
    const hit = VOCAB_BY_LEN.find((w) => tok.startsWith(w, i));
    if (hit) {
      out.push(hit);
      i += hit.length;
      continue;
    }
    let j = i + 1;
    while (j < tok.length && !VOCAB_BY_LEN.some((w) => tok.startsWith(w, j))) j++;
    out.push(tok.slice(i, j));
    i = j;
  }
  return out.join(" ");
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[#@_\-–—|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(splitToken)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

function blobOf(r: RawReel): string {
  return norm(`${r.caption} ${(r.hashtags ?? []).join(" ")}`);
}

function scoreReel(blob: string, signals: Signal[]): number {
  let total = 0;
  for (const s of signals) if (s.re.test(blob)) total += s.w;
  return total;
}

const LABEL: Record<ArchetypeId, string> = {
  singer: "singer",
  dancer: "dancer",
  comedian: "comedian",
  educator: "teacher",
  maker: "maker",
  fitness: "fitness coach",
  beauty: "beauty and fashion creator",
  travel: "travel creator",
  vlogger: "vlogger",
  family: "family creator",
  money: "money creator",
  gaming: "gaming creator",
  tech: "tech creator",
  collector: "watch and jewellery creator",
  documentary: "wildlife and nature creator",
  general: "creator",
};

/**
 * The words a person would actually type to find accounts like this.
 *
 * The label under the handle is written for the creator to read ("family
 * creator", "beauty and fashion creator"). The same phrase is not a search:
 * searching it returns nothing, or returns pages about creating content. The
 * cohort that search returns is the benchmark for every number in the plan, so
 * the two phrases have to be kept apart — the label is shown, this one is
 * searched.
 */
const SEARCH_SUBJECT: Record<ArchetypeId, string> = {
  singer: "singer",
  dancer: "dancer",
  comedian: "comedy",
  educator: "teacher",
  maker: "handmade",
  fitness: "fitness",
  beauty: "makeup",
  travel: "travel vlog",
  vlogger: "vlogger",
  family: "family vlog",
  money: "finance",
  gaming: "gaming",
  tech: "tech",
  collector: "watches",
  documentary: "wildlife",
  general: "",
};

/** The searchable subject for a kind of account, or "" when it is unknown. */
export function searchSubject(id: ArchetypeId): string {
  return SEARCH_SUBJECT[id] ?? "";
}

/**
 * The sentence shown under the handle. It names the lever out loud, so the plan
 * below it does not have to explain itself.
 */
const BLURB: Record<ArchetypeId, string> = {
  singer:
    "You post songs. The song you pick decides whether a cover travels — the edit only decides how far.",
  dancer:
    "You post dance. The track and the first eight counts are what hold a viewer, not the full routine.",
  comedian:
    "You post comedy. The first line is the whole job — the bit only lands if they stop for it.",
  educator:
    "You teach. What you promise in the first line, and how concrete the payoff is, decides whether it travels.",
  maker:
    "You make things people can see finished. Showing the finished plate or piece before the process is what earns the watch.",
  fitness:
    "You show bodies changing. Visible proof early beats any amount of explanation.",
  beauty:
    "You show a look, then how it was built. The before frame does most of the work.",
  travel:
    "You show places. One place, one feeling, held in the first second.",
  vlogger:
    "You post your own days. What carries a vlog is the shape of the video — the moment it opens on and the promise of where it goes.",
  family:
    "You post family life. The shape of the video and the moment it opens on decide whether people stay.",
  money:
    "You explain money. The promise in the first line is the whole job — the numbers behind it are what keeps them.",
  gaming: "You post play. The clip has to start on the moment, not the setup.",
  tech: "You show tools doing something real. Proof on screen beats describing it.",
  collector:
    "You post pieces people want to own. The item filling the frame in the first second decides whether they stop — the price is the question you answer before it is asked.",
  documentary:
    "You film the natural world. The footage is the whole post — start on the moment something happens, never on the approach to it.",
  general:
    "Your posts are the only honest source for what moves your account, so the plan below is built from them and from accounts your size.",
};

/**
 * Which family of advice a kind of account gets. This is the one decision the
 * whole plan hangs off, so it lives in one place with a plain reason attached:
 *
 * - songs   — the song is the decision (a cover only travels as far as the song does)
 * - formats — the shape of the video is the decision (a vlog needs a shape, not a hook)
 * - hooks   — the first spoken line is the decision (teaching, explaining, jokes)
 * - craft   — the visible result is the decision (a lift, a plate, a finished look)
 * - none    — the posts do not point anywhere yet, so nothing is forced on them
 */
export function recommendationFor(id: ArchetypeId): Recommendation {
  switch (id) {
    case "singer":
    case "dancer":
      return "songs";
    case "vlogger":
    case "travel":
    case "family":
      return "formats";
    case "educator":
    case "tech":
    case "comedian":
    case "money":
      return "hooks";
    case "maker":
    case "fitness":
    case "beauty":
    case "gaming":
      return "craft";
    default:
      return "none";
  }
}

/** True when the opening line is genuinely the lever for this kind of account. */
export function hooksMatter(id: ArchetypeId): boolean {
  return recommendationFor(id) === "hooks";
}

/** True when the song/audio choice is the single biggest variable. */
export function songsMatter(id: ArchetypeId): boolean {
  return recommendationFor(id) === "songs";
}

/** True when the shape of the video, not a line or a song, is the lever. */
export function formatsMatter(id: ArchetypeId): boolean {
  return recommendationFor(id) === "formats";
}

/** True when the visible finished result is the lever. */
export function craftMatters(id: ArchetypeId): boolean {
  return recommendationFor(id) === "craft";
}

export interface ArchetypeGuess {
  id: ArchetypeId;
  label: string;
  language?: string;
  /** 0..1 — how clearly the posts point at one kind of account */
  confidence: number;
  blurb: string;
  /** which family of advice this account gets */
  recommendation: Recommendation;
  songLed: boolean;
  hookLed: boolean;
  formatLed: boolean;
  /** plain reasons, used on the page under "why we think so" */
  evidence: string[];
}

function detectLanguage(reels: RawReel[]): string | undefined {
  const script = new Map<string, number>();
  const tagged = new Map<string, number>();

  for (const r of reels) {
    const text = `${r.caption} ${(r.hashtags ?? []).join(" ")}`;
    for (const [lang, re] of SCRIPTS) {
      if (re.test(text)) script.set(lang, (script.get(lang) ?? 0) + 1);
    }
    const words = new Set(norm(text).split(" "));
    for (const lang of LANGUAGE_TAGS) {
      const hit =
        words.has(lang) ||
        words.has(`${lang}songs`) ||
        words.has(`${lang}music`) ||
        words.has(`${lang}covers`) ||
        words.has(`${lang}cover`);
      if (hit) tagged.set(lang, (tagged.get(lang) ?? 0) + 1);
    }
  }

  const best = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])[0];

  const s = best(script);
  const t = best(tagged);
  // A script is decisive; a tag is only a hint, so it needs two posts.
  if (s && s[1] >= Math.max(2, reels.length * 0.25)) return s[0];
  if (t && t[1] >= 2) return t[0];
  return s?.[0] ?? t?.[0];
}

export function detectArchetype(reels: RawReel[], niche?: string): ArchetypeGuess {
  const scores = new Map<ArchetypeId, number>();
  for (const id of Object.keys(LEXICON) as ArchetypeId[]) {
    if (id === "general") continue;
    scores.set(id, 0);
  }

  // The niche phrase the account was found by is the strongest single clue —
  // it was itself derived from these posts, and it is not repeated per post.
  const nicheBlob = norm(niche ?? "");
  if (nicheBlob) {
    for (const [id, signals] of Object.entries(LEXICON) as [ArchetypeId, Signal[]][]) {
      if (id === "general" || !signals.length) continue;
      // ×4: one niche phrase is worth roughly four posts agreeing.
      scores.set(id, (scores.get(id) ?? 0) + 4 * scoreReel(nicheBlob, signals));
    }
  }

  for (const r of reels) {
    const blob = blobOf(r);
    for (const [id, signals] of Object.entries(LEXICON) as [ArchetypeId, Signal[]][]) {
      if (id === "general" || !signals.length) continue;
      scores.set(id, (scores.get(id) ?? 0) + scoreReel(blob, signals));
    }
    // The handle itself is a deliberate label, worth three posts' worth.
    const accountBlob = norm(r.account);
    for (const [id, signals] of Object.entries(LEXICON) as [ArchetypeId, Signal[]][]) {
      if (id === "general" || !signals.length) continue;
      const hit = scoreReel(accountBlob, signals);
      if (hit) scores.set(id, (scores.get(id) ?? 0) + 3 * hit);
    }
  }

  // Structural clues that keyword matching cannot see.
  const chronological = reels.filter((r) => r.postedAt);
  const numbered = chronological.filter((r) =>
    /\b(cover|day|ep|episode|part|song)\s*\[?\d+\s*[/\-–]\s*\d+/i.test(r.caption),
  ).length;
  if (numbered >= 2) {
    // A numbered run of covers is a music habit; a numbered run of posts is not.
    const musicLean = (scores.get("singer") ?? 0) >= (scores.get("educator") ?? 0);
    scores.set("singer", (scores.get("singer") ?? 0) + (musicLean ? numbered * 1.5 : 0));
  }

  const durations = reels
    .map((r) => r.durationSec)
    .filter((d): d is number => Boolean(d))
    .sort((a, b) => a - b);
  if (durations.length >= 4) {
    const mid = durations[Math.floor(durations.length / 2)];
    // Music reels run long (a verse plus a chorus); a 90s median is a strong hint
    // that the post is a performance rather than a talking-head explainer.
    if (mid >= 60) scores.set("singer", (scores.get("singer") ?? 0) + 1);
  }

  const ordered = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = ordered[0] ?? ["general", 0];
  const total = ordered.reduce((s, [, v]) => s + v, 0) || 1;

  // Below this, the posts do not point anywhere in particular — say so instead of
  // guessing, because a wrong archetype gives confidently wrong advice.
  if (topScore < 4) {
    return {
      id: "general",
      label: LABEL.general,
      confidence: 0,
      blurb: BLURB.general,
      // Nothing is forced on an account we cannot read: no songs, no video
      // shapes, and above all no hook advice dressed up as expertise.
      recommendation: "none",
      songLed: false,
      hookLed: false,
      formatLed: false,
      language: detectLanguage(reels),
      evidence: [],
    };
  }

  const language = detectLanguage(reels);
  const confidence = Math.min(0.95, topScore / Math.max(total, topScore * 1.6));

  const evidence: string[] = [];
  const counted = new Map<string, number>();
  for (const r of reels) {
    const blob = blobOf(r);
    for (const [id, signals] of Object.entries(LEXICON) as [ArchetypeId, Signal[]][]) {
      if (id !== topId) continue;
      for (const s of signals) {
        if (s.w < 2) continue;
        /**
         * Quote the words the post actually used. Parsing the pattern's source
         * instead produced filler ("vlogs, the, eat" — "the" came out of
         * /day in (my|the|a) life/), which reads like machine output on a page
         * whose whole promise is that a human wrote it.
         */
        const hit = s.re.exec(blob)?.[0]?.replace(/\s+/g, " ").trim().toLowerCase();
        if (!hit || hit.length > 30) continue;
        if (hit.split(" ").some((w) => EVIDENCE_STOP.has(w))) continue;
        counted.set(hit, (counted.get(hit) ?? 0) + 1);
      }
    }
  }
  const topWords = [...counted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topWords.length) {
    evidence.push(
      `Your own posts talk about ${topWords.map(([w]) => w).join(", ")}.`,
    );
  }
  if (language) evidence.push(`You post in ${language}.`);
  if (numbered >= 2) evidence.push(`${numbered} of your posts are numbered runs.`);

  return {
    id: topId,
    label: LABEL[topId],
    language,
    confidence,
    blurb: BLURB[topId],
    recommendation: recommendationFor(topId),
    songLed: songsMatter(topId),
    hookLed: hooksMatter(topId),
    formatLed: formatsMatter(topId),
    evidence,
  };
}

/** The cadence and length a kind of post usually needs, used only as a floor. */
export function typicalSeconds(id: ArchetypeId): [number, number] {
  switch (id) {
    case "singer":
    case "dancer":
      return [35, 75];
    case "educator":
    case "tech":
      return [25, 60];
    case "comedian":
      return [15, 45];
    case "maker":
      return [20, 45];
    case "fitness":
      return [15, 40];
    case "beauty":
    case "travel":
      return [15, 40];
    case "vlogger":
      // A vlog earns its length: cutting a day to 15 seconds removes the day.
      return [30, 75];
    case "family":
      return [20, 55];
    case "money":
      return [25, 55];
    case "gaming":
      return [10, 30];
    default:
      return [20, 60];
  }
}
