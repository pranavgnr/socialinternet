import { readFileSync } from "node:fs";
import { words } from "../lib/relevance";
for (const slug of ["personal-finance-for-young-adults","home-cooking-for-beginners","gym-workout-motivation","south-indian-recipes"]) {
  const raw = JSON.parse(readFileSync(`data/niches/${slug}.json`,"utf8"));
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
  const ok = new Map<string, number>(), tot = new Map<string, number>();
  for (const p of posts) {
    tot.set(p.account,(tot.get(p.account)??0)+1);
    const tokens = words([p.caption??"",(p.hashtags??[]).join(" "),""].join(" "));
    if (tokens.length<2 || tokens.some((w:string)=>subject.has(w)||core.has(w)))
      ok.set(p.account,(ok.get(p.account)??0)+1);
  }
  const accs = [...tot.keys()];
  const withTwo = accs.filter(a=>(ok.get(a)??0)>=2);
  const withOne = accs.filter(a=>(ok.get(a)??0)>=1);
  const keptReels = accs.reduce((n,a)=>n+(ok.get(a)??0),0);
  console.log(`\n${slug}: ${posts.length} reels, ${accs.length} accts, core=${core.size}`);
  console.log(`  accounts with >=2 on-subject: ${withTwo.length}   >=1: ${withOne.length}   reels kept: ${keptReels} (${Math.round(keptReels/posts.length*100)}%)`);
  for (const a of accs) console.log(`    ${a.slice(0,22).padEnd(23)} ${String(ok.get(a)??0).padStart(3)}/${tot.get(a)}`);
}
