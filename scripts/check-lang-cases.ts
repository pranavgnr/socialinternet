/**
 * Adversarial cases for the language gate, written as the leaks that actually
 * happened rather than as the rules that catch them.
 *
 * `eval-language.ts` scores the gate on real pulls, which is the honest measure
 * but a slow one: a pull holds one reel per account, so a pattern that only
 * shows up in a Turkish caption will not appear in an English pull until a
 * customer hits it. This file is the fast half — every failure mode we have
 * seen, reproduced, plus the opposite case that must not be sacrificed to fix
 * it. A rule that catches a leak by throwing out a real English cover is not a
 * fix, so each leak is paired with the reel it must not take with it.
 *
 *   npx tsx scripts/check-lang-cases.ts
 *
 * Exits non-zero on any failure, so it can gate a release.
 */
import { accountProfile, commentsLanguage, inLanguage, isSuspect, readLanguage } from "../lib/lang";
import { languageInQuery, roomLanguage } from "../lib/lang";
import type { RawReel } from "../lib/types";

let pass = 0;
let fail = 0;

function reel(id: string, over: Partial<RawReel> = {}): RawReel {
  return {
    platform: "instagram",
    account: over.account ?? "someone",
    url: `https://www.instagram.com/reel/${id}/`,
    caption: "",
    postedAt: "2026-09-01T00:00:00Z",
    views: 10_000,
    likes: 100,
    comments: 10,
    ...over,
  } as RawReel;
}

/** The verdict for one reel, with no account context. */
function verdict(over: Partial<RawReel>, want: string) {
  return inLanguage(reel("X", over), want, null);
}

function keeps(name: string, over: Partial<RawReel>, want = "en") {
  const v = verdict(over, want);
  if (v.keep) {
    pass += 1;
    console.log(`  ok   keep  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL keep  ${name} — dropped [${v.why}]`);
  }
}

function drops(name: string, over: Partial<RawReel>, want = "en", why?: string) {
  const v = verdict(over, want);
  if (!v.keep && (!why || v.why === why)) {
    pass += 1;
    console.log(`  ok   drop  ${name} [${v.why}]`);
  } else {
    fail += 1;
    console.log(
      `  FAIL drop  ${name} — ${v.keep ? "kept" : `dropped as ${v.why}, wanted ${why}`}` +
        ` (read ${readLanguage(over).code ?? "?"}/${readLanguage(over).from ?? "-"})`,
    );
  }
}

/* --------------------------------- English -------------------------------- */

console.log("\n=== English covers that must survive an English pull");
keeps("bare English caption", { caption: "a little ukelele cover" });
keeps("song title, no word 'cover'", { caption: "wildflower - billie eilish" });
keeps("emoji only", { caption: "🎧✨💖" });
keeps("no caption at all", {});
keeps("English with a Spanish song name", {
  caption: "Despacito but make it acoustic 🌴",
  hashtags: ["acousticcover", "despacito"],
});
keeps("English with a Hindi film song, sung in English", {
  caption: "my English version of this Bollywood classic 💛 #englishcover",
  hashtags: ["englishcover", "bollywood"],
});
keeps("Filipino creator, English cover, home-country tag", {
  caption: "loving this song so much #cover #pinoy",
  hashtags: ["cover", "pinoy"],
});
keeps("Indian creator, English cover", {
  caption: "tried singing this in my own style, hope you like it",
  hashtags: ["singingcover", "indian",
  ],
});
keeps("Russian title, English cover", {
  caption: "#yad (яд) ENGLISH COVER — original by Erika Lundmoen",
  hashtags: ["yad", "coversong"],
});
keeps("two Cyrillic characters in an English sentence", {
  caption: "this one is called Яд and the English version is out now",
});
keeps("Japanese band, English lyric", {
  caption: "we covered this in English, hope you enjoy 🎸",
  hashtags: ["coverband", "jrock"],
});
keeps("English caption naming the language it is in", {
  caption: "an english cover of a turkish song 🇹🇷",
  hashtags: ["englishcover"],
});
keeps("Korean artist name, English caption", {
  caption: "Jungkook's voice is unreal, my cover of Seven",
  hashtags: ["cover", "seven"],
});
keeps("English caption, one Hindi word as a term of address", {
  caption: "yaar this song is so good, had to cover it",
  hashtags: ["cover"],
});

/* ------------------------------ the leaks --------------------------------- */

console.log("\n=== Other languages that must not survive an English pull");
drops("Telugu script caption", { caption: "ఆర్ తూకుం ఈ పాట లో" });
drops("Telugu romanised caption", { caption: "chala bagundi ee paata #telugusongs" });
drops("Telugu film song title, English caption", {
  caption: "barbaad - saiyaara just hits you in the feels",
});
drops("Telugu cover tagged in Telugu", {
  caption: "love this song ❤️",
  hashtags: ["telugusongs", "telugucovers"],
});
drops("Hindi romanised + film title", { caption: "Kesariya 🌸 #cover" });
drops("Hindi script", { caption: "ये गाना बहुत प्यारा है" });
drops("Turkish with diacritics", { caption: "aşk kalbim çok güzel 🥰 #cover" });
drops("Turkish without diacritics", { caption: "seni seviyorum sarki cover" });
drops("Turkish tag only", {
  caption: "my cover of this one 🎶",
  hashtags: ["turkishcovers", "turkce"],
});
drops("Spanish corrido", {
  caption: "Amor - got some new music coming",
  hashtags: ["musicamexicana", "corridos"],
});
drops("Portuguese", { caption: "saudade disso, minha gente ❤️ #cover" });
drops("Korean script", { caption: "이 노래 너무 좋아 #cover" });
drops("Japanese script", { caption: "この歌が大好き #cover" });
drops("Arabic script", { caption: "أحب هذه الأغنية #cover" });
drops("Russian script caption", { caption: "моя любимая песня, кавер" });
drops("Thai script", { caption: "เพลงนี้เพราะมาก #cover" });
drops("Indonesian", { caption: "lagu ini bagus banget #cover" });
drops("Tagalog caption", { caption: "iririsk ang lahat by kuya bruno mars #cover" });
drops("Arabic cover, announced in English", {
  caption: "since a lot of you wanted an arabic cover :)",
});
drops("Lebanese dialect tag", {
  caption: "some of y'all requested this song",
  hashtags: ["lebanese", "songcover"],
});
drops("Hindi cover, English caption, Hindi tags", {
  caption: "tribute to KK sir on his birthday, hope y'all like it",
  hashtags: ["bollywood", "hindisongs"],
});
drops("Punjabi", { caption: "kudi soni 🎶 #punjabi" });
drops("English room, Telugu provider tag", {
  caption: "",
  language: "te",
});

/* --------------------------- bilingual accounts --------------------------- */

console.log("\n=== Account context: one reel is not the whole creator");

/** A profile built the way `shape()` builds it, from the account's reels. */
function accountProfileOf(reels: RawReel[], want: string) {
  const p = accountProfile(reels, want);
  return p.mixed ? null : p;
}

{
  // A Telugu account that writes English captions: its own posts prove the
  // language, so an English-captioned Telugu song is its content, not the room's.
  const account = "sing.dha";
  const reels = [
    reel("T1", { account, caption: "chuttamale - devara", hashtags: ["telugusongs"] }),
    reel("T2", { account, caption: "nammaka tappani - bomarillu", hashtags: ["telugu"] }),
    reel("T3", { account, caption: "maate vinadhuga", hashtags: ["telugucovers", "telugu"] }),
    reel("T4", { account, caption: "love this song so much ❤️" }),
  ];
  const profile = accountProfileOf(reels, "en");
  const v = inLanguage(reels[3], "en", profile);
  /**
   * Marked, not quietly kept. Nothing in this reel says it is Telugu — only the
   * account does — so the gate names the suspicion and hands the reel to the
   * video and the comments. `shape()` drops it if neither can speak, which is
   * the outcome this case used to assert directly.
   */
  if (isSuspect(v.why) && v.why === "suspect:te") {
    pass += 1;
    console.log(`  ok   suspect  English caption on a Telugu account [${v.why} → dropped unless a witness says otherwise]`);
  } else {
    fail += 1;
    console.log(`  FAIL suspect  English caption on a Telugu account — ${v.keep ? "kept" : "dropped"} [${v.why}]`);
  }
}
{
  // A creator who genuinely covers in both languages: each reel is judged on
  // its own evidence, so the English one stays.
  const account = "two.way";
  const reels = [
    reel("B1", { account, caption: "english cover of a hindi song", hashtags: ["englishcover"] }),
    reel("B2", { account, caption: "tum hi ho 🎶", hashtags: ["hindisongs"] }),
    reel("B3", { account, caption: "another english cover for you", hashtags: ["englishcover"] }),
    reel("B4", { account, caption: "saiyaara 💔", hashtags: ["bollywood"] }),
    reel("B5", { account, caption: "somewhere only we know", hashtags: ["cover"] }),
  ];
  const profile = accountProfileOf(reels, "en");
  const v = inLanguage(reels[4], "en", profile);
  if (v.keep) {
    pass += 1;
    console.log(`  ok   keep  English cover on a bilingual account [${v.why}]`);
  } else {
    fail += 1;
    console.log(`  FAIL keep  English cover on a bilingual account — dropped [${v.why}]`);
  }
  const hi = inLanguage(reels[3], "en", profile);
  if (!hi.keep) {
    pass += 1;
    console.log(`  ok   drop  Hindi song on the same bilingual account [${hi.why}]`);
  } else {
    fail += 1;
    console.log(`  FAIL drop  Hindi song on the same bilingual account — kept [${hi.why}]`);
  }
}
{
  // A tag-spam account: eleven Japanese posts and one hashtag in English.
  const account = "spam.jp";
  const reels = Array.from({ length: 11 }, (_, i) =>
    reel(`J${i}`, { account, caption: "この歌が大好き", hashtags: ["cover"] }),
  );
  reels.push(reel("J11", { account, caption: "english songs vibes", hashtags: ["englishsongs"] }));
  const profile = accountProfileOf(reels, "en");
  const v = inLanguage(reels[11], "en", profile);
  /**
   * Same shape of answer: one tag is not a language, and it is not enough to
   * overrule an account that is eleven twelfths Japanese either. The reel is
   * suspect, and the pass gets a chance to prove the tag right.
   */
  if (isSuspect(v.why) && v.why === "suspect:ja") {
    pass += 1;
    console.log(`  ok   suspect  English tag on a Japanese tag-spam account [${v.why} → dropped unless a witness says otherwise]`);
  } else {
    fail += 1;
    console.log(`  FAIL suspect  English tag on a Japanese tag-spam account — ${v.keep ? "kept" : "dropped"} [${v.why}]`);
  }
}

/* -------------------------------- comments -------------------------------- */

console.log("\n=== The audience speaks: comments as evidence");

const HINDI_COMMENTS = [
  "kya baat hai bhai",
  "bahut pyara gaana hai",
  "mast gana hai yaar",
  "dil se suna",
];
const TELUGU_COMMENTS = ["super ga undhi akka", "chala bagundi ra", "nidhra poru emo", "ee song keka"];
const ENGLISH_COMMENTS = ["love this cover", "your voice is amazing", "what song is this", "obsessed"];
const EMOJI = ["🔥", "❤️", "🙌", "😍"];

{
  const r = commentsLanguage(HINDI_COMMENTS.map((text) => ({ text })));
  if (r?.code === "hi") {
    pass += 1;
    console.log(`  ok   read  Hindi comments [${r.agreeing}/${r.labelled}]`);
  } else {
    fail += 1;
    console.log(`  FAIL read  Hindi comments — got ${r?.code ?? "nothing"}`);
  }
}
{
  const r = commentsLanguage(EMOJI.map((text) => ({ text })));
  if (!r) {
    pass += 1;
    console.log("  ok   read  emoji-only comments say nothing");
  } else {
    fail += 1;
    console.log(`  FAIL read  emoji-only comments claimed ${r.code}`);
  }
}
{
  const r = reel("C1", { caption: "love this one 💛", topComments: HINDI_COMMENTS.map((text) => ({ text, likes: 0 })) });
  const v = inLanguage(r, "en", null);
  if (!v.keep) {
    pass += 1;
    console.log(`  ok   drop  English caption, Hindi audience [${v.why}]`);
  } else {
    fail += 1;
    console.log(`  FAIL drop  English caption, Hindi audience — kept [${v.why}]`);
  }
}
{
  const r = reel("C2", { caption: "", topComments: ENGLISH_COMMENTS.map((text) => ({ text, likes: 0 })) });
  const v = inLanguage(r, "en", null);
  if (v.keep) {
    pass += 1;
    console.log(`  ok   keep  silent caption, English audience [${v.why}]`);
  } else {
    fail += 1;
    console.log(`  FAIL keep  silent caption, English audience — dropped [${v.why}]`);
  }
}
{
  // A Telugu account, but this reel's audience is plainly English: two
  // independent signals (the post's own silence aside) beat the account.
  const account = "telugu.acct";
  const reels = [
    reel("A1", { account, caption: "chuttamale", hashtags: ["telugusongs"] }),
    reel("A2", { account, caption: "nammaka tappani", hashtags: ["telugu"] }),
    reel("A3", { account, caption: "maate vinadhuga", tags: ["telugu"] } as Partial<RawReel>),
    reel("A4", {
      account,
      caption: "somewhere only we know",
      topComments: [...ENGLISH_COMMENTS, "so good", "goosebumps"].map((text) => ({ text, likes: 0 })),
    }),
  ];
  const profile = accountProfileOf(reels, "en");
  const v = inLanguage(reels[3], "en", profile);
  if (v.keep) {
    pass += 1;
    console.log(`  ok   keep  English cover on a Telugu account, English audience [${v.why}]`);
  } else {
    fail += 1;
    console.log(`  FAIL keep  English cover on a Telugu account, English audience — dropped [${v.why}]`);
  }
}

/* --------------------------------- the room -------------------------------- */

console.log("\n=== What language the room is in");
{
  const q = languageInQuery("english music covers");
  const ok = q?.code === "en";
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} room  phrase names English`);
}
{
  // "india" is a place, not a language: a Telugu cover is a valid result for
  // "music covers in india", so the room must not be narrowed to Hindi.
  const r = roomLanguage("music covers in india");
  const ok = r.basis !== "query";
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} room  "india" is not a language (${r.code ?? "none"}/${r.basis})`);
}
{
  const r = roomLanguage("telugu music covers");
  const ok = r.code === "te" && r.basis === "query";
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} room  phrase names Telugu (${r.code}/${r.basis})`);
}
{
  // A pull that is half Telugu must not become a Telugu room: that is how the
  // English reels in it were being thrown out by the round before last.
  const pull = [
    ...Array.from({ length: 6 }, (_, i) => reel(`P${i}`, { caption: "ఆర్ తూకుం" })),
    ...Array.from({ length: 6 }, (_, i) => reel(`Q${i}`, { caption: "loving this song" })),
  ];
  const r = roomLanguage("music covers", { pull });
  const ok = r.basis === "none";
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} room  a half-foreign pull is mixed, not one room (${r.code ?? "none"}/${r.basis})`);
}

{
  /**
   * The bilingual artist, and the reason "suspect" exists.
   *
   * A Mexican regional singer with seven posts tagged #musicamexicana and a
   * handful of English originals ("Tattoos", #indie #alt). Under a blanket
   * account rule his English singles were thrown out of an English-covers
   * pull; under no account rule at all a Telugu singer's English-captioned
   * film songs walk straight in. Both are English words over a reel, so the
   * gate marks the reel instead of guessing: kept for now, and handed to the
   * video and the comments to settle.
   */
  const posts = [
    ...Array.from({ length: 7 }, (_, i) =>
      reel(`S${i}`, { account: "elijah", caption: "chicos tristes #musicamexicana #cover" }),
    ),
    reel("S7", { account: "elijah", caption: "chained in my ways… 🔗😅 #indie #alt" }),
    reel("S8", { account: "elijah", caption: "on Santa Monica sand btw ✌️ #bts #videography" }),
  ];
  const profile = accountProfile(posts, "en");
  const v = inLanguage(posts[7], "en", profile.mixed ? null : profile);
  const ok = v.keep && isSuspect(v.why);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} suspect  English single on a Spanish account (${v.keep ? "kept" : "dropped"}/${v.why})`);

  /**
   * And the same reel, once the audience speaks. An English comment section is
   * the witness that settles it, so the post must leave the suspect state
   * rather than wait for a video that may not exist.
   */
  const settled = inLanguage(
    { ...posts[7], topComments: ["love this song", "your voice is amazing", "what song is this", "obsessed"].map((text) => ({ text })) },
    "en",
    profile.mixed ? null : profile,
  );
  const ok2 = settled.keep && !isSuspect(settled.why);
  ok2 ? pass++ : fail++;
  console.log(`  ${ok2 ? "ok  " : "FAIL"} suspect  English audience settles it (${settled.why})`);

  /**
   * The other side of the same account: a post that names its own song. No
   * suspect state needed — the reel said what it was.
   */
  const named = inLanguage(
    reel("S9", { account: "sing._.dha", caption: "barbaad - saiyaara just hits you in the feels" }),
    "en",
    null,
  );
  const ok3 = !named.keep;
  ok3 ? pass++ : fail++;
  console.log(`  ${ok3 ? "ok  " : "FAIL"} suspect  a named Hindi song needs no account (${named.why})`);
}

console.log(`\n${fail ? "FAIL" : "PASS"}: ${pass} passed${fail ? `, ${fail} failed` : ""}`);
process.exitCode = fail ? 1 : 0;
