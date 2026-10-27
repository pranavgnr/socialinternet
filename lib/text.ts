/** Shared tokenisation used by clustering, dedupe, fit scoring and topic phrasing. */

const STOP = new Set(
  (
    // English function words
    "a an the and or but if then than that this these those i you we they it is are was were be been to of in on for with at by from my your our their as not no do does did how what why when who which just really very so about into over under more most " +
    // caption furniture: CTAs and engagement bait that say nothing about topic
    "comment follow share save like dm link bio free guide pdf below send want grab click tap here now today new full step steps video videos reel reels " +
    // generic nouns that read as filler in a topic slot ("3 things about something")
    "something things stuff anyone someone everyone nobody everything anything nothing thing things way ways " +
    // adverbs that pass a content-word filter but carry no topic
    "actually literally basically probably definitely maybe simply honestly seriously " +
    // contraction fragments left behind when "I’ll" splits on a curly apostrophe
    "ll re ve don didn doesn isn aren wasn weren won wouldn couldn shouldn " +
    // Indonesian / Malay
    "dan yang di ke dari untuk ini itu dengan ada aku kamu kita bisa akan sudah juga banget gimana cara ni tuh sih dong atau tidak saya mereka tapi kalau saat setelah sebelum lebih paling sangat gratis bisa belum hanya masih saja semua banyak orang hari mau jadi buat " +
    // Spanish / Portuguese
    "para por con sin que los las el la de del en un una es son esta este como pero mas muy tu su mi meu minha nao não você voce " +
    // French
    "pour avec sans les des le une est sont ce cette comme mais tres très votre notre mon ton " +
    // German / Dutch / Italian
    "fur für mit ohne dass der die das und ist sind ein eine zu von im den dem des nicht auch het van niet ook per gli lo il sono questo questa molto"
  )
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Particles that are strong evidence a caption is NOT English, even when it
 * borrows English loanwords ("WhatsApp Automation — Day 6 … aa jayega").
 * Loanwords alone let Hinglish and Indonesian captions through the marker test,
 * and a leaked phrase then appears verbatim in a hook template.
 */
const FOREIGN_MARKERS = new Set(
  (
    "jayega jayegi jaega kare karta karti karna karne raha rahi rahe sakta sakte " +
    "nahi nahin hoga hogi hota wala wali wale bahut bhi sirf abhi kya kaise " +
    // Romanized-Hindi glue. These never appear in English text, and without
    // them "Complete setup ka link tumhare DM mein automatically aa jayega"
    // scored one foreign word against two English ones and got through.
    "ka ki ke karke mein hai hain karo tumhare tumhara tumhe aur ko se aa " +
    "untuk dengan adalah tidak bisa sudah belum lebih paling sangat karena " +
    "tidak anda mereka kami kita banget gimana caranya nih dong deh " +
    "você não para você muito isso isto aqui também então "
  )
    .split(/\s+/)
    .filter(Boolean),
);

const ENGLISH_MARKERS = new Set(
  (
    "the and to of you is this that for with how why what in on my your it we i " +
    "a an are was were be been from at by or but not do does did if then than " +
    "when who which just we our they their them he she his her"
  )
    .split(/\s+/)
);

export function isStopword(w: string): boolean {
  return STOP.has(w);
}

/**
 * Verbs that turn a candidate topic into a sentence fragment. A pillar or a
 * topic slot names a thing, so "seen need bmw", "claude got" and "skill file
 * used" are all broken noun phrases, not ideas. Kept in one place because the
 * hand-written lists at each end of safeTopic() kept missing forms ("seen").
 */
const VERB_WORDS = new Set(
  (
    "is are was were be been being am do does did done has have had having " +
    "build builds built make makes made get gets got gotten give gives gave " +
    "given take takes took taken use uses used using need needs needed want " +
    "wants wanted know knows knew think thinks thought say says said see sees " +
    "saw seen show shows showed work works worked try tries tried test tests " +
    "tested run runs ran spend spends spent find finds found grow grows grew " +
    "turn turns turned launch launches launched automate automates automated " +
    "write writes wrote written sell sells sold hire hires hired fire fires " +
    "fired create creates created learn learns learned start starts started " +
    "stop stops stopped post posts posted add adds added set sets put puts " +
    "keep keeps kept watch watches watched tell tells told send sends sent " +
    "let lets buy buys bought pay pays paid read reads write fix fixes fixed " +
    "check checks checked open opens opened close closes closed call calls " +
    "called play plays played flatten flattens flattened beat beats beaten " +
    "quit quits quit lose loses lost win wins won hit hits hitting"
  ).split(/\s+/).filter(Boolean),
);

/** True when the text contains a verb — i.e. it is a clause, not a noun phrase. */
export function hasVerbWord(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z']+/)
    .some((w) => VERB_WORDS.has(w));
}

export function isVerbWord(w: string): boolean {
  return VERB_WORDS.has(w.toLowerCase());
}

/** True when any word is a non-English particle — used to reject topic slots. */
export function hasForeignWords(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean)
    .some((w) => FOREIGN_MARKERS.has(w));
}

/**
 * Content words in order, with the noise removed. Hashtags, @mentions, URLs,
 * emoji, punctuation and non-Latin scripts are stripped so a Cyrillic or CJK
 * caption cannot leak fragments into an English cluster label.
 */
export function contentWords(text: string): string[] {
  return text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\w.]+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && /[a-z]/.test(w) && !STOP.has(w));
}

/** Tokens for topic matching. */
export function tokens(text: string): Set<string> {
  return new Set(contentWords(text));
}

/**
 * Cheap language gate. SocialCrawl reports `computed.language`, but captions
 * arrive from keyword search across every account posting in that space, so a
 * good share are Indonesian, Portuguese or Spanish. A caption with no English
 * function word at all is not a safe source for an English topic phrase.
 */
export function looksEnglish(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z']+/)
    .filter(Boolean);
  if (!words.length) return false;

  /**
   * A single foreign particle is enough to disqualify a caption unless the
   * English evidence clearly outweighs it. Marketing captions mix in English
   * loanwords ("WhatsApp Automation", "AI tool"), so counting only English
   * markers let Hinglish through on the strength of borrowed nouns.
   */
  const foreign = words.filter((w) => FOREIGN_MARKERS.has(w)).length;
  // Hinglish reuses English tokens as Hindi ones ("is" = this, "do" = give),
  // so those cannot count as evidence of English. Only unambiguous English
  // words count, otherwise a Hindi caption rescues itself with "is" and "do".
  const english = words.filter(
    (w) => ENGLISH_MARKERS.has(w) && !FOREIGN_MARKERS.has(w),
  ).length;

  // Three or more non-English particles is conclusive: no English caption
  // carries that much foreign glue.
  if (foreign >= 3) return false;
  if (foreign > 0 && english < 2) return false;

  if (english > 0) return true;
  // short captions that are all ASCII letters and contain a known niche term
  // ("n8n workflow demo") are fine even without a function word
  return words.length <= 6 && /[a-z]{3}/.test(text) && !/[^\x00-\x7F]/.test(text)
    ? /(ai|n8n|api|automation|workflow|agent|claude|gpt|prompt)/i.test(text)
    : false;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export function clamp(n: number, lo = 0, hi = 1): number {
  return Math.min(hi, Math.max(lo, n));
}
