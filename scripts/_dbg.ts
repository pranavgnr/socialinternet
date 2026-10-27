import { readFileSync } from "node:fs";
import { words } from "../lib/relevance";
const raw = JSON.parse(readFileSync("data/niches/personal-finance-for-young-adults.json","utf8"));
const posts = raw.payload;
const per = new Map<string, Set<string>>();
for (const p of posts) {
  const s = per.get(p.account) ?? new Set<string>();
  for (const w of words([p.caption??"", (p.hashtags??[]).join(" ")].join(" "))) s.add(w);
  per.set(p.account, s);
}
console.log("accounts", per.size);
const holders = new Map<string, number>();
for (const s of per.values()) for (const w of s) holders.set(w,(holders.get(w)??0)+1);
const floor = Math.max(2, Math.ceil(per.size*0.35));
console.log("floor", floor);
console.log("top shared words:", [...holders.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([w,n])=>`${w}:${n}`).join(" "));
const subject = new Set(words("personal finance for young adults"));
console.log("subject words:", [...subject]);
