import { readFileSync } from "node:fs";
import { keepOnSubject, headWord } from "../lib/subject";
const raw = JSON.parse(readFileSync("data/niches/personal-finance-for-young-adults.json","utf8"));
const posts = raw.payload;
console.log("head word:", headWord(raw.query));
const v = keepOnSubject(posts, raw.query);
const droppedCaps = v.dropped.map((d:any)=>d.reel.caption);
for (const probe of ["MIT Longevity Expert","Best Financial Advice","MONEY Milestones"]) {
  const kept = v.kept.some((r:any)=>(r.caption??"").includes(probe));
  console.log(`  ${probe.slice(0,24).padEnd(26)} kept=${kept}`);
}
// per-account median over on-subject reels
const by = new Map<string, number[]>();
for (const r of v.kept as any[]) {
  const l = by.get(r.account) ?? []; l.push(r.views ?? 0); by.set(r.account, l);
}
const med = (a:number[])=>{const s=[...a].sort((x,y)=>x-y);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
console.log("\ntop accounts by median views (on-subject only):");
[...by.entries()].sort((a,b)=>med(b[1])-med(a[1])).slice(0,8)
  .forEach(([a,vs])=>console.log(`  ${a.slice(0,22).padEnd(23)} n=${String(vs.length).padStart(2)} median=${Math.round(med(vs)).toLocaleString()}`));
