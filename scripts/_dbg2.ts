import { readFileSync } from "node:fs";
import { words } from "../lib/relevance";
import { keepOnSubject } from "../lib/subject";
const raw = JSON.parse(readFileSync("data/niches/personal-finance-for-young-adults.json","utf8"));
const posts = raw.payload;
const v = keepOnSubject(posts, raw.query);
// recompute which fail
const subject = new Set(words(raw.query));
const keptSet = new Set(v.kept.map((p:any)=>p.url));
const fails = posts.filter((p:any)=>!keptSet.has(p.url));
console.log("fails", fails.length);
for (const f of fails.slice(0,18)) console.log(" -", f.account, "|", (f.caption||"").slice(0,72));
