import { readFileSync } from "node:fs";
import { keepOnSubject } from "../lib/subject";
const raw = JSON.parse(readFileSync("data/niches/personal-finance-for-young-adults.json","utf8"));
const posts = raw.payload;
const v = keepOnSubject(posts, raw.query);
console.log("applied", v.applied, "kept", v.kept.length, "vocab:", v.vocab.join(" "));
const m = new Map<string,number[]>();
for (const r of v.kept as any[]) { const l=m.get(r.account)??[]; l.push(r.views); m.set(r.account,l); }
for (const [a,vs] of [...m.entries()].sort((x,y)=>y[1].length-x[1].length))
  console.log(`  ${a.slice(0,22).padEnd(23)} ${String(vs.length).padStart(2)} kept`);
console.log("\nmelrobbins captions NOT kept:");
for (const r of posts.filter((p:any)=>p.account==="melrobbins")) {
  if (!(v.kept as any[]).some((k:any)=>k.url===r.url)) console.log("  -", (r.caption??"").slice(0,64));
}
