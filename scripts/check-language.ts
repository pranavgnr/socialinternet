/**
 * Offline check of the language gate. Reads the cached niche pulls and the
 * bought posts, so it costs nothing, and prints what the gate did to each one:
 * what was kept, what was thrown out and on what evidence.
 *
 * Two halves, because the evidence differs by source:
 *   · keyword searches carry a caption, tags and sometimes an audio title
 *   · only a bought post carries comments, which is where the audience speaks
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  accountProfile,
  commentsLanguage,
  dominantLanguage,
  languageName,
  readLanguage,
} from "../lib/lang";
import { researchFromCache } from "../lib/niche";
import type { RawReel } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "niches");
const files = [
  "english-music-covers",
  "music-covers-in-india",
  "kannada-songs-singing-covers",
  "telugu-music-covers",
  "daily-vlogs-india",
  "ai-automation",
];

for (const slug of files) {
  const file = path.join(DIR, `${slug}.json`);
  if (!existsSync(file)) continue;
  const stored = JSON.parse(readFileSync(file, "utf8")) as {
    query?: string;
    payload?: RawReel[];
  };
  const query = stored.query ?? slug.replace(/-/g, " ");
  const payload = (stored.payload ?? []) as RawReel[];
  const research = researchFromCache(query, payload);

  const HOW = {
    query: "named in the phrase",
    own: "read off the creator's own account",
    pull: "inferred — most of the pull, no language in the phrase",
    none: "no constraint — the pull was mixed, so nothing was filtered",
  } as const;
  console.log(
    `\n=== ${query}  →  wanted ${languageName(research.language.wanted)} (${
      HOW[research.language.basis ?? "none"]
    })`,
  );
  console.log(
    `   reels ${research.totalReels} → kept ${research.reels}, dropped ${research.language.dropped} ${JSON.stringify(research.language.by)}`,
  );
  console.log(
    `   accounts kept (${research.accounts.length}): ${research.accounts
      .map((a) => a.handle)
      .slice(0, 8)
      .join(", ")}`,
  );
  console.log(`   median views: ${research.nicheMedianViews}`);

  /**
   * Accounts thrown out as a whole, with the evidence that condemned them. This
   * is the list a customer would ask about, so it is printed as they would read
   * it: handle, language, and the share that decided it.
   */
  const wanted = research.language.wanted;
  const byAccount = new Map<string, RawReel[]>();
  for (const r of payload) {
    const list = byAccount.get(r.account) ?? [];
    list.push(r);
    byAccount.set(r.account, list);
  }
  const gone: string[] = [];
  for (const [handle, list] of byAccount) {
    const p = accountProfile(list, wanted);
    if (p.mixed || !p.lang || p.lang === wanted) continue;
    gone.push(
      `${handle} (${languageName(p.lang)}${p.dominance ? ` ${Math.round(p.dominance.share * 100)}%` : ""})`,
    );
  }
  if (gone.length) console.log(`   dropped accounts: ${gone.slice(0, 10).join(", ")}`);
}

/* ------------------- evidence only a bought post has ------------------- */

const postCache = path.join(process.cwd(), "data", "_post_cache.json");
if (existsSync(postCache)) {
  const cache = JSON.parse(readFileSync(postCache, "utf8")) as Record<
    string,
    { caption?: string; audioName?: string; topComments?: { text?: string }[] }
  >;
  console.log("\n=== bought posts: audio title and comment evidence");
  for (const [url, post] of Object.entries(cache)) {
    const caption = readLanguage(post);
    const audio = readLanguage({ audioName: post.audioName });
    const said = commentsLanguage(post.topComments);
    console.log(
      `   ${url.replace("https://www.instagram.com/reel/", "").replace("/", "")}` +
        ` | caption ${caption.code ?? "—"}${caption.from ? `/${caption.from}` : ""}` +
        ` | audio ${audio.code ?? "—"}${audio.from === "audio" ? "" : audio.from ? `/${audio.from}` : ""}` +
        ` | comments ${said ? `${said.code} ${said.agreeing}/${said.labelled} (${Math.round(said.share * 100)}%)` : "—"}`,
    );
  }

  /**
   * What the comments would say if every search result were bought. Cheap to
   * compute here, expensive to buy — printed so the trade-off is visible
   * rather than assumed.
   */
  const all = Object.values(cache);
  const withComments = all.filter((p) => (p.topComments?.length ?? 0) >= 3);
  console.log(
    `   ${withComments.length} of ${all.length} bought posts carry enough comments to read a language from`,
  );
}
