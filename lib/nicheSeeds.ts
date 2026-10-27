/**
 * Interest -> candidate niche phrases.
 *
 * A new creator usually cannot name their niche; they can only name what they
 * know or enjoy. This maps the second onto the first, so the engine has
 * something concrete to price.
 *
 * Rules for every phrase here, because each one becomes a paid search:
 *
 *  - two to four words, the way a person would type it, never a hashtag
 *  - a subject, not a mood: "home workout" prices, "discipline" does not
 *  - no platform words ("reels", "viral", "fyp") — they describe the algorithm,
 *    and searching them returns the whole platform rather than a room
 *  - specific enough to be a room, broad enough to have winners in it
 *
 * `alt` holds the second and third choices, ordered: the engine tries the first
 * and only spends on the next if the first comes back thin.
 */

export interface InterestGroup {
  id: string;
  /** what the creator sees on the chip */
  label: string;
  /** words that should overlap with a space for the fit score to move */
  words: string[];
  niches: string[];
}

const BASE_INTERESTS: InterestGroup[] = [
  {
    id: "fitness",
    label: "Fitness & gym",
    words: ["fitness", "gym", "workout", "training", "health", "muscle", "home", "body"],
    niches: ["home workout", "gym motivation", "beginner fitness", "calisthenics"],
  },
  {
    id: "food",
    label: "Food & cooking",
    words: ["food", "cooking", "recipe", "kitchen", "baking", "street", "chef"],
    niches: ["quick recipes", "street food", "home cooking", "healthy recipes"],
  },
  {
    id: "tech",
    label: "Tech & AI",
    words: ["tech", "ai", "software", "coding", "automation", "tools", "developer"],
    niches: ["ai tools", "ai automation", "coding tutorial", "tech review"],
  },
  {
    id: "money",
    label: "Money & finance",
    words: ["money", "finance", "invest", "stock", "savings", "salary", "tax"],
    niches: ["personal finance", "stock market basics", "money saving", "side income"],
  },
  {
    id: "business",
    label: "Business & startups",
    words: ["business", "startup", "sales", "marketing", "clients", "agency"],
    niches: ["small business tips", "startup lessons", "freelance business", "marketing tips"],
  },
  {
    id: "beauty",
    label: "Beauty & skincare",
    words: ["beauty", "makeup", "skincare", "hair", "skin", "products"],
    niches: ["skincare routine", "makeup tutorial", "hair care", "nail art", "beauty products"],
  },
  {
    id: "fashion",
    label: "Fashion & style",
    words: ["fashion", "style", "outfit", "clothes", "thrift", "styling"],
    niches: ["outfit ideas", "thrift fashion", "styling tips", "budget fashion"],
  },
  {
    id: "travel",
    label: "Travel",
    words: ["travel", "trip", "places", "budget", "hotel", "hill"],
    niches: ["budget travel", "solo travel", "hidden places", "travel vlog"],
  },
  {
    id: "comedy",
    label: "Comedy & entertainment",
    words: ["comedy", "funny", "sketch", "jokes", "humour", "relatable"],
    niches: ["relatable comedy", "sketch comedy", "comedy skit", "observational comedy"],
  },
  {
    id: "music",
    label: "Music & singing",
    words: ["music", "singer", "song", "cover", "guitar", "lyrics"],
    niches: ["music covers", "singing cover", "original songs", "acoustic cover"],
  },
  {
    id: "dance",
    label: "Dance",
    words: ["dance", "dancer", "choreography", "moves", "hip", "bollywood"],
    niches: ["dance choreography", "dance tutorial", "bollywood dance", "hip hop dance"],
  },
  {
    id: "education",
    label: "Teaching & study",
    words: ["teaching", "study", "exam", "students", "english", "learn", "school"],
    niches: ["exam preparation", "english speaking", "study tips", "homeschooling", "language learning", "maths tricks"],
  },
  {
    id: "gaming",
    label: "Gaming",
    words: ["gaming", "game", "stream", "mobile", "esports", "clips"],
    niches: ["mobile gaming", "game highlights", "gaming tips", "game streaming"],
  },
  {
    id: "art",
    label: "Art & design",
    words: ["art", "drawing", "painting", "design", "sketch", "illustration"],
    niches: ["art process", "drawing tutorial", "digital art", "painting timelapse"],
  },
  {
    id: "home",
    label: "Home & interiors",
    words: ["home", "interior", "decor", "rent", "small", "organise"],
    niches: ["home decor", "small apartment ideas", "interior design", "home renovation", "home organisation"],
  },
  {
    id: "diy",
    label: "DIY & crafts",
    words: ["diy", "craft", "handmade", "build", "make", "repair", "wood"],
    niches: ["diy crafts", "handmade crafts", "woodworking projects", "diy home projects"],
  },
  {
    id: "parenting",
    label: "Parenting & family",
    words: ["parenting", "baby", "kids", "mother", "family", "toddler"],
    niches: ["parenting tips", "baby care", "mom life", "kids activities"],
  },
  {
    id: "pets",
    label: "Pets & animals",
    words: ["dog", "cat", "pet", "puppy", "training", "animal"],
    niches: ["dog training", "pet care", "cat videos", "puppy training"],
  },
  {
    id: "health",
    label: "Health & nutrition",
    words: ["health", "nutrition", "diet", "sleep", "weight", "calories"],
    niches: ["healthy eating", "weight loss", "nutrition tips", "mental health", "sleep health"],
  },
  {
    id: "mindset",
    label: "Motivation & mindset",
    words: ["motivation", "mindset", "discipline", "habits", "productivity", "self"],
    niches: ["self improvement", "productivity habits", "discipline motivation", "morning routine"],
  },
  {
    id: "spiritual",
    label: "Spirituality & astrology",
    words: ["spiritual", "astrology", "meditation", "tarot", "prayer", "yoga"],
    niches: ["meditation practice", "astrology reading", "spiritual growth", "yoga practice"],
  },
  {
    id: "sports",
    label: "Sports",
    words: ["cricket", "football", "sports", "match", "training", "athlete"],
    niches: ["cricket analysis", "football skills", "sports training", "match breakdown"],
  },
  {
    id: "photography",
    label: "Photography & video",
    words: ["photography", "camera", "photo", "videography", "editing", "shoot"],
    niches: ["phone photography", "photo editing", "camera tips", "videography tips"],
  },
  {
    id: "work",
    label: "Jobs & career",
    words: ["job", "career", "interview", "resume", "corporate", "office"],
    niches: ["career advice", "interview preparation", "corporate life", "resume tips"],
  },
  {
    id: "realestate",
    label: "Property & renting",
    words: ["property", "realestate", "rent", "flat", "land", "investment"],
    niches: ["property investment", "renting tips", "real estate advice", "flat hunting"],
  },
  {
    id: "auto",
    label: "Cars & bikes",
    words: ["car", "bike", "motorcycle", "engine", "driving", "review"],
    niches: ["car review", "bike review", "car maintenance", "driving tips"],
  },
];

/**
 * Words and spaces the first taxonomy did not have.
 *
 * `scripts/check-coverage.ts` measured the gap: of 86 realistic descriptions, 63
 * resolved to nothing and a brand-new creator was told to "pick something you
 * know" after telling us exactly what they know. The vocabulary is kept separate
 * from the groups above so the expansion is auditable in one place — you can
 * read this list against a real complaint and see the fix.
 *
 * Two rules hold here exactly as above: a word is a *subject* someone could post
 * about, and it goes in the group whose rooms a creator would recognise. Where a
 * word honestly belongs to two spaces it is listed in both and `ambiguousWords()`
 * demotes it automatically — that mechanism is what keeps "home" from deciding
 * between a gym and a kitchen, and it works for every word below.
 */
const EXTRA_WORDS: Record<string, string[]> = {
  fitness: ["cardio", "calisthenics", "powerlifting", "abs", "weightloss", "gymrat"],
  food: ["biryani", "coffee", "cocktail", "cocktails", "sourdough", "curry", "spice", "vegan", "snack"],
  tech: [
    "cybersecurity", "cyber", "security", "data", "science", "prompt", "engineering",
    "web", "development", "programming", "python", "javascript", "code", "excel", "sql",
  ],
  money: ["crypto", "trading", "investing", "insurance", "wealth", "portfolio", "budgeting"],
  business: ["logistics", "supply", "chain", "entrepreneur", "dropshipping", "freelance"],
  beauty: ["nail", "nails", "lashes", "acne", "serum", "grooming"],
  fashion: ["menswear", "mens", "ootd", "sneakers", "streetwear"],
  travel: ["abroad", "visa", "immigration", "backpacking", "itinerary"],
  comedy: ["memes", "meme", "satire", "roast", "prank"],
  music: ["vinyl", "playlist", "lofi", "beatmaking"],
  dance: ["kathak", "salsa", "hiphop", "bhangra"],
  education: [
    "homeschool", "homeschooling", "student", "language", "chemistry", "physics",
    "biology", "maths", "math", "teacher", "teachers", "tutorial",
  ],
  gaming: ["minecraft", "valorant", "bgmi", "speedrun", "pcbuild"],
  art: ["calligraphy", "sketching", "portrait", "watercolor"],
  home: ["minimalism", "minimal", "declutter", "organisation", "organization"],
  diy: [
    "knitting", "crochet", "sewing", "pottery", "jewellery", "jewelry", "leather",
    "woodworking", "restoration", "restore", "handmade", "calligraphy",
  ],
  parenting: ["mum", "mom", "mummy", "newborn", "nursery", "homeschooling"],
  pets: ["veterinary", "vet", "aquarium", "kitten"],
  health: [
    "dentistry", "dentist", "physiotherapy", "physio", "pharmacy", "pharmacist",
    "clinic", "medical", "mental",
  ],
  mindset: ["sobriety", "sober", "anxiety", "depression", "selfcare", "journaling"],
  spiritual: ["manifestation", "puja", "bhakti", "chanting"],
  sports: [
    "marathon", "running", "badminton", "swimming", "cycling", "athletics",
    "tennis", "kabaddi", "skateboarding", "climbing", "surfing",
  ],
  photography: ["iphone", "lightroom", "lens", "composition"],
  work: [
    "nurse", "nursing", "hospital", "lawyer", "law", "legal", "accountant",
    "accounting", "architect", "recruitment", "hr", "salaryman",
  ],
  realestate: ["investing", "investor", "mortgage", "landlord", "estate"],
  auto: ["ev", "suv", "detailing", "restoration", "watch", "watches"],
};

/**
 * Two spaces the taxonomy was missing outright.
 *
 * Both are large, both are full of small accounts breaking out, and both were
 * previously answered with a shrug. "What can I post about" is the exact question
 * a new creator arrives with, so a missing space is a missing answer.
 */
const EXTRA_GROUPS: InterestGroup[] = [
  {
    id: "culture",
    label: "Books, film & culture",
    words: [
      "book", "books", "reading", "reader", "anime", "manga", "film", "movie",
      "movies", "history", "chess", "crime", "culture", "literature", "poetry",
      "mythology",
    ],
    niches: [
      "book recommendations", "film analysis", "history facts", "true crime stories",
      "anime edits",
    ],
  },
  {
    id: "nature",
    label: "Plants & nature",
    words: ["garden", "gardening", "plants", "plant", "bee", "bees", "beekeeping", "aquascaping"],
    niches: ["gardening tips", "plant care", "indoor plants", "beekeeping", "aquascaping"],
  },
];

function mergeInterests(base: InterestGroup[]): InterestGroup[] {
  const groups = base.map((g) => ({
    ...g,
    words: [...new Set([...g.words, ...(EXTRA_WORDS[g.id] ?? [])])],
  }));
  return [...groups, ...EXTRA_GROUPS];
}

export const INTERESTS: InterestGroup[] = mergeInterests(BASE_INTERESTS);

const BY_ID = new Map(INTERESTS.map((g) => [g.id, g]));

export function interestGroup(id: string): InterestGroup | undefined {
  return BY_ID.get(id);
}

/**
 * Candidate phrases for a set of chosen interests.
 *
 * One phrase per interest on the first pass, so six interests cost six searches
 * and not eighteen. `depth > 1` adds the alternatives, which the recommend
 * route only asks for when the first pass came back thin.
 */
export function candidatesFor(
  ids: string[],
  depth = 1,
  text?: string,
): { query: string; interest: string }[] {
  const out: { query: string; interest: string }[] = [];
  const seen = new Set<string>();
  /**
   * When the creator's own words are available, the room inside a group is
   * chosen the same way the group was: by overlap with what they said.
   *
   * Without this, "cat behaviour" landed on the pets group correctly and then
   * took its first room — "dog training" — because the list order is editorial,
   * not personal. Ranking the rooms puts "cat videos" first, which is the
   * difference between a recommendation and a non-sequitur.
   */
  const said = text ? tokens(text) : null;

  for (const id of ids) {
    const group = BY_ID.get(id);
    if (!group) continue;
    const niches = [...group.niches];
    if (said) niches.sort((a, b) => phraseOverlap(b, said) - phraseOverlap(a, said));

    for (const query of niches.slice(0, Math.max(1, depth))) {
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ query, interest: group.id });
    }
  }
  return out;
}

/** The interest words a set of ids stands for, for the fit score. */
export function wordsFor(ids: string[]): string[] {
  return ids.flatMap((id) => BY_ID.get(id)?.words ?? []);
}

/**
 * Words that belong to more than one space, and therefore identify none.
 *
 * "home" sits in fitness ("home workout") and in interiors ("home decor"), so a
 * creator who typed "home cooking for busy people" matched both and the engine
 * ranked a gym room first. The word is not wrong in either list — it is the
 * *single shared* word that carries no information, and the fix belongs in one
 * place rather than in each list.
 *
 * Derived from the taxonomy rather than hand-listed, so adding a space cannot
 * quietly reintroduce the problem: a word that starts appearing in two groups
 * becomes ambiguous on its own.
 */
export function ambiguousWords(): Set<string> {
  const seen = new Map<string, number>();
  for (const g of INTERESTS) {
    for (const w of new Set(g.words)) seen.set(w, (seen.get(w) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [w, n] of seen) if (n > 1) out.add(w);
  return out;
}

/** How much one matched word says about the space. Shared words count half. */
export function wordWeight(word: string, ambiguous = ambiguousWords()): number {
  return ambiguous.has(word) ? 0.5 : 1;
}

/** The words a piece of free text is actually made of. */
function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);
}

/** How many of a phrase's own words the creator actually said. */
function phraseOverlap(phrase: string, said: Set<string>): number {
  let n = 0;
  for (const w of phrase.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (said.has(w)) n += 1;
  }
  return n;
}

export interface GroupMatch {
  id: string;
  /** weighted word score: a specific word counts 1, a shared word 0.5 */
  score: number;
  /** the words that fired, for diagnosis */
  matched: string[];
  /** the best niche-token overlap in the group — the tie-breaker */
  overlap: number;
}

/**
 * Rank interest groups by how well they fit what the creator typed.
 *
 * This replaces a filter that returned groups in *declaration order*: any group
 * that matched any word came back, and the caller took the first. Because
 * `fitness` is declared first it won every tie, so "dog training" resolved to
 * "home workout" — fitness matched the shared word "training", pets matched
 * "dog" (specific) and "training" (shared), and the better answer was thrown
 * away by ordering rather than by scoring. Every wrong room in
 * `scripts/check-coverage.ts` came from this one line.
 *
 * Three signals, in order:
 *
 *  1. **Weighted word score.** "dog" is worth 1, "training" is worth 0.5
 *     because `ambiguousWords()` sees it in fitness and sports too. Specificity
 *     is what separates a room from a mood.
 *  2. **Niche overlap.** On a tie, the group whose own phrasings actually
 *     contain what was typed wins. "mental health" scores 0.5 in both fitness
 *     and health; only health has a room with those words in it.
 *  3. **Declaration order**, so the result stays stable between runs.
 */
export function rankGroups(text: string): GroupMatch[] {
  const said = tokens(text);
  if (!said.size) return [];
  const ambiguous = ambiguousWords();

  const out: GroupMatch[] = [];
  for (const g of INTERESTS) {
    const matched = [...new Set(g.words)].filter((w) => said.has(w));
    const named = said.has(g.id);
    if (!matched.length && !named) continue;

    out.push({
      id: g.id,
      score: matched.reduce((n, w) => n + wordWeight(w, ambiguous), 0) + (named ? 1 : 0),
      matched,
      overlap: Math.max(0, ...g.niches.map((n) => phraseOverlap(n, said))),
    });
  }

  // Array.prototype.sort is stable, so equal rows keep declaration order.
  return out.sort((a, b) => b.score - a.score || b.overlap - a.overlap);
}

/** Free-text fallback: turn "I like cooking and football" into candidate chips. */
export function matchInterests(text: string): string[] {
  return rankGroups(text).map((g) => g.id);
}
