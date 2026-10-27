import { readFileSync } from "node:fs";
import { words } from "../lib/relevance";
import { headWord } from "../lib/subject";
const raw = JSON.parse(readFileSync("data/niches/personal-finance-for-young-adults.json","utf8"));
const posts = raw.payload;
const per = new Map<string, Set<string>>();
for (const p of posts) {
  const s = per.get(p.account) ?? new Set<string>();
  for (const w of words([p.caption??"", (p.hashtags??[]).join(" ")].join(" "))) s.add(w);
  per.set(p.account, s);
}
const holders = new Map<string, number>();
for (const s of per.values()) for (const w of s) holders.set(w,(holders.get(w)??0)+1);
const floor = Math.max(2, Math.ceil(per.size*0.35));
const core = new Set([...holders.entries()].filter(([,n])=>n>=floor).map(([w])=>w));
const subject = new Set(words(raw.query));
console.log("head:", headWord(raw.query), "| core:", [...core].join(" "));
const target = posts.filter((p:any)=>(p.caption??"").includes("Glow Up"));
for (const t of target) {
  const toks = words([t.caption??"",(t.hashtags??[]).join(" "),""].join(" "));
  const hits = toks.filter((w:string)=>w===headWord(raw.query)||core.has(w)||subject.has(w));
  console.log("\ncaption:", t.caption);
  console.log("tokens:", toks.join(" "));
  console.log("hits:", hits.join(" "));
}
