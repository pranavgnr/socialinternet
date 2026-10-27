/**
 * Turns the account's own hashtags into the phrase printed on the page.
 *
 * Without a model, the niche is inferred from hashtags, and hashtags are
 * written without spaces: "#aiautomation", "#telugucovers", "#gymmotivation".
 * Joining three of them gave plans that read "Forgemindai aiautomation
 * claudeai" under the handle — the account's own name and two brand tags, not
 * a description of anything.
 *
 * So each tag is split back into words it is made of, tags that are really the
 * account's name are dropped, and only tags built from words we recognise
 * survive. A tag nobody can read ("claudeai", "forgemindai") is not a
 * description of a space, and it is not shown as one.
 *
 * One tag wins, never a handful: the words are only a description when they
 * were written together. `coherentLabel` is the rule, and `nicheQuality` is the
 * check that runs before a phrase is allowed to cost credits.
 */
import { contentWords, isStopword } from "./text";

/** Niche words that get glued together in hashtags, longest first at match time. */
const WORDS = new Set(
  (
    "ai automation automatic agent agents bot bots robot robotics machine machines " +
    "tech technology software coding code developer dev programming python javascript " +
    "data analytics cloud saas startup startups business entrepreneur marketing sales " +
    "finance money investing investment stock stocks crypto trading trading " +
    "fitness gym workout workouts bodybuilding muscle training trainer yoga pilates " +
    "health nutrition diet weightloss fatloss calories protein " +
    "music singer singers singing song songs cover covers cover song musician band " +
    "guitar piano drums producer beat beats rap rapcover lofi " +
    "dance dancer dancing choreography " +
    "comedy funny humour humor meme memes standup " +
    "food cooking recipe recipes baking baker cake kitchen chef street " +
    "fashion style outfit outfits stylist clothing streetwear thrift " +
    "beauty makeup skincare hair nails salon cosmetic cosmetics " +
    "travel traveller travel vlog vlogs wanderlust backpacking " +
    "art artist artwork drawing painting sketch design designer graphic ui ux " +
    "photo photographer photography videographer video videos filmmaker editing editor " +
    "gaming gamer games esports streamer streaming " +
    "education teacher teaching student students study learning exam exams neet jee " +
    "english spoken hindi telugu tamil kannada malayalam marathi bengali punjabi gujarati urdu " +
    "indian india desi mumbai delhi bangalore hyderabad chennai pune kolkata " +
    "wedding bridal bride groom prewedding pregnancy parenting mom momlife dad " +
    "diy crafts craft handmade gardening plants plant pets dog dogs cat cats " +
    "realestate property interior interiors decor home decor " +
    "law lawyer doctor medical nursing pharmacy " +
    "astrology tarot spiritual spirituality meditation mindset motivation motivational " +
    "quotes life lifestyle daily routine habits productivity " +
    "travel foodie blogger influencer creator content creators reels shorts " +
    "industrial factory packaging industrial counting smartfactory industry40 logistics " +
    "ecommerce ecom dropshipping amazon shopify store brand brands " +
    "sports cricket football gym fit coach coaching athlete running cycling swimming " +
    "language languages accent vocabulary grammar " +
    "kids children family couple relationships dating " +
    /*
     * Everything below was missing, and a missing word is not a neutral gap:
     * `segment()` only accepts a hashtag when *every* character is covered by a
     * known word, so "#wildlifedocumentary" on a genuine wildlife account
     * returned null, the tag-based label came back empty, and the plan fell
     * through to whatever the model guessed — which is how a bird-nest
     * documentary channel got labelled "pets_animals". A nature creator, a car
     * channel or a temple account had no route to a correct label at all.
     */
    "nature wildlife documentary documentaries bird birds nest nesting animal animals " +
    "safari marine forest ocean reef conservation ecology biology species habitat " +
    "architecture architect architects building buildings construction civil engineer " +
    "plumbing renovation blueprint skyline skyscraper " +
    "car cars bike bikes motorcycle bikes motorcycle auto automotive vehicle engine " +
    "mechanic garage detailing motorsport racing " +
    "agriculture farming farmer farmers harvest organic crop crops dairy poultry " +
    "cinema movie movies film films actor actress trailer teaser webseries " +
    "anime manga cartoon cartoons animation comics " +
    "devotion devotional bhakti temple temples religion religious god goddess " +
    "spiritual spirituality meditation mindfulness astrology horoscope tarot " +
    "salon spa tattoo barber grooming skincare " +
    "restaurant cafe bakery street food biryani tiffin snack recipes " +
    "saree lehenga kurti jewellery jewelry bridal " +
    "review reviews unboxing gadget gadgets smartphone smartphonegadgets " +
    "cybersecurity hacking ethicalhacking programming python javascript " +
    "minecraft freefire bgmi valorant pubg roblox esports " +
    "kabaddi badminton tennis volleyball hockey athletics marathon " +
    "baby newborn pregnancy toddlers toddler kids " +
    "insurance tax loans sip mutualfunds mutual funds savings " +
    "mental mentalhealth therapy anxiety depression healing " +
    "upsc iit neet jee gk current affairs exam exams " +
    "dj remix mashup karaoke lyrics instrumental live music " +
    "interior interiors decor homedecor realestate property renting " +
    "photography camera lens portrait portraits landscape streetphotography"
  ).split(/\s+/),
);

const MIN_PIECE = 2;

/**
 * Tags the whole platform uses. They are not a subject, so they can never be
 * part of a label — "#trending" on a comedy reel describes the algorithm, not
 * the account.
 */
const REACH = new Set(
  (
    "reels reel reelsinstagram reelitstitch reelsvideo reelsfyp fyp fyppage " +
    "fypage fypviral foryou foryoupage viral viralreels trending trend explore " +
    "explorepage instagram instagramreels ig love follow like share subscribe " +
    "short shorts youtube ytshorts instadaily explorepage video videos post " +
    "posts content creator creators meme memes entertainment fun funny humour humor"
  ).split(/\s+/),
);

/**
 * Words that qualify a subject without being one. "telugu" says which telugu,
 * not what the account does, so it belongs in front of a subject word and can
 * never stand as the label by itself.
 */
const QUALIFIER = new Set(
  (
    "telugu kannada tamil hindi malayalam marathi punjabi bengali gujarati " +
    "urdu bhojpuri indian india desi mumbai delhi bangalore bengaluru hyderabad " +
    "chennai pune kolkata kerala tamilnadu andhra"
  ).split(/\s+/),
);

export interface TagStat {
  tag: string;
  count: number;
  /** total views of the reels carrying the tag, when known */
  views?: number;
}

/**
 * The label, built from one tag rather than a handful of them.
 *
 * The old version collected words from the top four tags and glued them
 * together: "comedy" + "funnydance" + "telugu" became "comedy funny dance
 * telugu". Each word was true and the phrase was meaningless — nobody types
 * that into Instagram, and a search for it returned AI animation pages, whose
 * numbers then became the creator's benchmark. A label has to be a phrase.
 *
 * So one tag wins, with a language word in front of it when the account is
 * plainly regional: "telugu comedy", "kannada music covers", "ai automation".
 */
export function coherentLabel(stats: TagStat[], account?: string): string {
  const own = account ? norm(account) : "";
  const usable: { words: string[]; count: number; views: number; subject: boolean }[] = [];

  for (const s of stats) {
    const tag = s.tag.replace(/^#+/, "").toLowerCase().trim();
    if (!tag || tag.length < 3 || /^\d+$/.test(tag)) continue;
    if (own && norm(tag).includes(own)) continue;
    if (REACH.has(tag) || /(.)\1{3,}/.test(tag)) continue;

    const words = tag.includes("_") ? tag.split(/_+/).filter(Boolean) : segment(tag);
    if (!words?.length) continue;
    // A tag made only of reach words or only of a language says nothing on its
    // own; it is kept as a candidate qualifier, never as the subject.
    const subject = words.some((w) => !REACH.has(w) && !QUALIFIER.has(w));
    usable.push({ words, count: s.count, views: s.views ?? 0, subject });
  }

  if (!usable.length) return "";

  const subjects = usable.filter((u) => u.subject);
  const pool = subjects.length ? subjects : usable;
  // Count first: a tag on three reels describes the account better than a tag
  // on one. Views break the tie, then specificity ("funny dance" over "funny").
  pool.sort(
    (a, b) =>
      b.count - a.count || b.views - a.views || b.words.length - a.words.length,
  );

  const best = pool[0];
  const phrase = best.words.filter((w) => !REACH.has(w)).slice(0, 3);
  if (!phrase.length) return "";

  // A language only leads when the account actually leans on it: one stray
  // "#telugu" on a Kannada singer's feed is how she got filed under the wrong
  // language.
  if (!phrase.some((w) => QUALIFIER.has(w))) {
    const qualifier = usable
      .filter((u) => u.words.length === 1 && QUALIFIER.has(u.words[0]))
      .sort((a, b) => b.count - a.count || b.views - a.views)
      .find((u) => u.count >= Math.max(2, Math.ceil(best.count * 0.6)));
    if (qualifier) phrase.unshift(qualifier.words[0]);
  }

  return phrase.slice(0, 4).join(" ");
}

/**
 * Is this phrase a search someone would actually type?
 *
 * Checked before anything is spent on it. A pull costs real credits, and the
 * credits are not the expensive part — the cohort it returns becomes the
 * creator's benchmark for every number in the plan.
 */
/**
 * Bucket names a model tends to answer with when asked for a niche.
 *
 * These are categories in *somebody's* taxonomy — "pets_animals", "art",
 * "lifestyle" — and none of them is a phrase a viewer types to find an account.
 * A live run returned "pets_animals" for a bird-nest documentary channel: the
 * answer was filed under a category, printed with an underscore, and shipped to
 * the page as if it were a niche. It is not wrong so much as useless, and
 * useless advice reads as machine output.
 *
 * Only single-word buckets are rejected here. "pets animals" as two words is
 * still weak, but "pet bird care" is a real phrase and must survive.
 */
const GENERIC = new Set(
  (
    "misc miscellaneous general other others lifestyle content creator creators " +
    "influencer influencers socialmedia instagram reels videos video stuff things"
  ).split(/\s+/),
);

/**
 * One spelling of a niche phrase, used everywhere.
 *
 * The model writes "pets_animals"; hashtags arrive as "#kannadaSongCovers"; a
 * person types "Kannada Song Covers". All three have to become one string
 * before anything compares or searches them, or the same room gets researched
 * twice and the cache never hits.
 */
export function normaliseNiche(raw: string): string {
  return (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NicheQuality {
  ok: boolean;
  words: string[];
  reason?: string;
}

export function nicheQuality(query: string): NicheQuality {
  const given = (query ?? "").trim();
  /**
   * An underscore is the tell.
   *
   * Nobody types "pets_animals" into a search box; that is a row in a taxonomy,
   * and a model asked for a niche will sometimes hand one back. Normalising it
   * to "pets animals" and accepting it — which is what this function used to do
   * — turns a category into a niche and then spends credits searching for it.
   * Rejecting the shape outright pushes the caller onto its own tag-based
   * fallback, which knows the account's actual words.
   */
  if (given.includes("_")) {
    return {
      ok: false,
      words: given.split(/_+/).filter(Boolean),
      reason: "a category label, not a search phrase",
    };
  }

  const raw = given.toLowerCase().replace(/[_-]+/g, " ");
  const words = raw.split(/[\s,]+/).filter(Boolean);
  if (!words.length) return { ok: false, words, reason: "no phrase given" };
  if (words.length === 1 && GENERIC.has(words[0])) {
    return { ok: false, words, reason: "names no subject — say what the posts are about" };
  }
  if (words.length > 5) {
    return { ok: false, words, reason: "too many words — a search phrase is two to five" };
  }
  if (words.some((w) => /(.)\1{3,}/.test(w))) {
    return { ok: false, words, reason: "looks like a hashtag, not a phrase" };
  }
  const subject = words.filter((w) => !REACH.has(w) && !isStopword(w));
  if (!subject.length) {
    return { ok: false, words, reason: "only reach words — it names no subject" };
  }
  if (subject.length < words.length / 2) {
    return {
      ok: false,
      words,
      reason: "mostly reach words — what is the account actually about?",
    };
  }
  return { ok: true, words };
}

/** Longest lexicon word that starts at `i`, or null. */
function matchAt(s: string, i: number): string | null {
  let best: string | null = null;
  for (const w of WORDS) {
    if (w.length > s.length - i) continue;
    if (s.startsWith(w, i) && (!best || w.length > best.length)) best = w;
  }
  return best;
}

/**
 * "aiautomation" -> ["ai", "automation"]. Returns null unless the whole string
 * is covered by known words, so a brand name is never guessed into pieces.
 */
function segment(word: string): string[] | null {
  if (WORDS.has(word)) return [word];
  const out: string[] = [];
  let i = 0;
  while (i < word.length) {
    const m = matchAt(word, i);
    if (!m) return null;
    out.push(m);
    i += m.length;
  }
  return out.length >= 2 && out.every((p) => p.length >= MIN_PIECE) ? out : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "#TeluguCovers" -> "telugu covers", "#gym_motivation" -> "gym motivation". */
export function humanizeTag(raw: string): string {
  const tag = raw.replace(/^#+/, "").replace(/[_.]+/g, " ").trim().toLowerCase();
  if (!tag) return "";
  return tag
    .split(/\s+/)
    .map((part) => segment(part)?.join(" ") ?? part)
    .join(" ");
}

/**
 * The phrase printed under a handle, from raw hashtags.
 *
 * Order matters: a tag that splits into real words is a description; a tag that
 * does not is a brand. Only descriptions are used, and the account's own name is
 * removed first — "forgemindai" on @forgemind_ai describes the account, not the
 * space it posts in.
 */
export function labelFromTags(tags: string[], account?: string): string {
  return coherentLabel(
    tags.map((tag) => ({ tag, count: 1 })),
    account,
  );
}

export interface CaptionRow {
  caption?: string;
  views?: number;
  hashtags?: string[];
}

/** Caption punctuation that ends a thought, so phrases never straddle it. */
const CLAUSE_BREAK = /[.!?|,;:\n•·"'“”()\[\]]+|\s[-–—]\s+/;

/**
 * Title words that describe the *video's grammar*, not its subject.
 *
 * Measured on the cached pulls: without this list the best-scoring phrase for a
 * recipe channel was "tried every" and for BuzzFeed Tasty "cast tries" — both
 * honest readings of the titles, both useless as a niche. A phrase is only a
 * description of a space if its words could answer "what is this account about",
 * and a verb cannot.
 */
const NOISE = new Set(
  (
    "try tries tried trying make makes made making get gets got getting give gives " +
    "gave take takes took taking use uses used using do does did doing go goes went " +
    "come comes came know knows knew want wants wanted need needs needed say says said " +
    "look looks looked feel feels felt eat eats ate cook cooks cooked watch watches " +
    "watched put puts putting keep keeps kept let lets letting see sees saw " +
    "every ever really actually finally first last full minute minutes min hour hours " +
    "day days week weeks month months year years best worst top vs ft feat " +
    "cast part episode ep shorts short"
  ).split(/\s+/),
);

/**
 * The label from captions, for pulls that have no hashtags at all.
 *
 * Measured on the cached pulls: 13 of 26 rooms came back with **zero** hashtags,
 * every one of them a YouTube pull, because that endpoint returns a title rather
 * than a tagged description. `coherentLabel` reads hashtags only, so it returned
 * nothing for half the library and the page fell back to a keyword mash. The
 * advice was still generated, but the room had no name — and an unnamed room is
 * the first thing that makes a plan read like machine output.
 *
 * The method is the hashtag method with a different source: take the phrases the
 * account actually writes, in its own titles, and prefer the one that recurs
 * across its posts. Recurrence is the whole signal — a phrase in one title is a
 * topic of that video, a phrase in six titles is what the channel is about.
 *
 * Language is not checked here: the caller judges the finished phrase with
 * `nicheQuality`, and rejecting non-English per caption would drop Indian-English
 * titles that are perfectly good evidence.
 */
export function labelFromCaptions(rows: CaptionRow[], account?: string): string {
  const own = account ? norm(account) : "";
  const counts = new Map<string, { reels: number; views: number }>();

  for (const row of rows) {
    const text = (row.caption ?? "").replace(/https?:\/\/\S+/g, " ");
    if (!text) continue;

    /** One vote per phrase per reel, so a caption that repeats itself is not louder. */
    const seen = new Set<string>();
    for (const clause of text.split(CLAUSE_BREAK)) {
      /**
       * Words capitalised mid-clause are almost always names — "Chris Bumstead",
       * "Ganesh Chaturthi". A name in the label turns a room into a person, and
       * the plan then searches Instagram for somebody's surname.
       */
      const raw = clause.split(/\s+/).filter((t) => /[A-Za-z]/.test(t));
      const capped = raw.filter((t, i) => i > 0 && /^[A-Z]/.test(t.replace(/[^A-Za-z0-9']/g, "")));
      /**
       * Only meaningful when the clause is not Title Cased throughout. "Melt In
       * Your Mouth Chicken" capitalises every word as a style, and reading that
       * as a list of names deleted the entire caption — nine of thirteen rooms
       * lost their label on the first attempt at this rule.
       */
      const proper = new Set<string>();
      if (raw.length > 1 && capped.length / (raw.length - 1) <= 0.5) {
        for (const t of capped) proper.add(t.replace(/[^A-Za-z0-9']/g, "").toLowerCase());
      }

      const words = contentWords(clause).filter(
        (w) =>
          !REACH.has(w) &&
          !NOISE.has(w) &&
          !proper.has(w) &&
          !(own && (w.includes(own) || own.includes(w))),
      );
      for (const n of [2, 3]) {
        for (let i = 0; i + n <= words.length; i += 1) {
          const phrase = words.slice(i, i + n).join(" ");
          if (seen.has(phrase)) continue;
          seen.add(phrase);
          const c = counts.get(phrase) ?? { reels: 0, views: 0 };
          c.reels += 1;
          c.views += row.views ?? 0;
          counts.set(phrase, c);
        }
      }
    }
  }

  /**
   * Two reels minimum. One title is not a description of a channel, and the
   * whole point of this function is the phrase the account keeps coming back to.
   */
  const ranked = [...counts.entries()]
    .filter(([, c]) => c.reels >= 2)
    .sort(
      (a, b) =>
        b[1].reels - a[1].reels ||
        b[1].views - a[1].views ||
        b[0].split(" ").length - a[0].split(" ").length,
    );

  for (const [phrase] of ranked.slice(0, 40)) {
    if (nicheQuality(phrase).ok) return phrase;
    /** A three-word phrase may be rejected while its two-word head is fine. */
    const head = phrase.split(" ").slice(0, 2).join(" ");
    if (head !== phrase && nicheQuality(head).ok) return head;
  }

  return "";
}

/** A token written as one glued word that turns out to be two known words. */
function isGlued(token: string): boolean {
  const t = token.replace(/^#+/, "").toLowerCase();
  if (t.length < 6 || WORDS.has(t)) return false;
  const segs = segment(t);
  return Boolean(segs && segs.length >= 2);
}

/**
 * Make any stored niche string presentable.
 *
 * A phrase a model already wrote properly ("ai automation", "telugu music
 * covers") is left exactly as it is. Only hashtag soup is rebuilt — recognised
 * by a token that is really two words glued together, which is what a tag looks
 * like and what a written phrase never does.
 */
export function nicheLabel(niche?: string): string {
  const raw = (niche ?? "").trim();
  if (!raw) return "";
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  if (!tokens.some(isGlued)) return raw;
  const out = labelFromTags(tokens);
  return out || raw;
}
