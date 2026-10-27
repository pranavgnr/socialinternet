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
const holders = new Map<string, number>();
for (const s of per.values()) for (const w of s) holders.set(w,(holders.get(w)??0)+1);
const floor = Math.max(2, Math.ceil(per.size*0.35));
const core = new Set([...holders.entries()].filter(([,n])=>n>=floor).map(([w])=>w));
const subject = new Set(words(raw.query));
const vocabSet = new Set([...subject]);
let pass=0, fail=0, silent=0;
const fails:any[]=[];
for (const p of posts) {
  const text = [p.caption??"", (p.hashtags??[]).join(" "), ""].join(" ");
  const tokens = words(text);
  if (tokens.length < 2) { silent++; pass++; continue; }
  if (tokens.some((w:string)=>subject.has(w)||vocabSet.has(w)||core.has(w))) pass++;
  else { fail++; fails.push(p); }
}
console.log({pass, fail, silent, coreSize: core.size});
console.log("core:", [...core].slice(0,40).join(" "));
for (const f of fails.slice(0,15)) console.log(" -", f.account, "|", (f.caption||"").slice(0,70));
