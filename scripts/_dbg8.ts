import { readFileSync } from "node:fs";
import { keepOnSubject } from "../lib/subject";
const raw = JSON.parse(readFileSync("data/niches/kannada-song-covers.json","utf8"));
const v = keepOnSubject(raw.payload, raw.query);
console.log("applied", v.applied, "kept", v.kept.length, "/", raw.payload.length);
console.log("vocab:", v.vocab.join(" "));
console.log("\n--- dropped (first 10) ---");
for (const d of v.dropped.slice(0,10)) {
  const r:any = d.reel;
  console.log("cap:", JSON.stringify((r.caption??"").slice(0,80)));
  console.log("tags:", JSON.stringify((r.hashtags??[]).slice(0,8)));
  console.log("");
}
