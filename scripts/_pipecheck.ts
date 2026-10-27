import { runPipeline } from "../lib/pipeline";
import { createStore } from "../lib/store";
import fs from "node:fs";
import path from "node:path";

const dir = fs.readdirSync("data/accounts").filter(d => d.startsWith("efffe96c"))[0];
const base = path.join("data/accounts", dir);
const db = createStore(base);
const profile = JSON.parse(fs.readFileSync(path.join(base, "profile.json"), "utf8"));
console.log("handle:", profile.handle ?? "(none)", "| niche:", profile.niche, "| platform:", profile.platform);

(async () => {
  const t = Date.now();
  try {
    await runPipeline({ profile, seedReels: [], db } as any);
    const ideas = await db.getIdeas();
    console.log("OK", ((Date.now()-t)/1000).toFixed(1)+"s | ideas:", ideas.length);
    for (const i of ideas.slice(0, 3)) console.log("  -", i.title);
  } catch (e) {
    console.log("FAILED", ((Date.now()-t)/1000).toFixed(1)+"s:", (e as Error).message);
    console.log((e as Error).stack?.split("\n").slice(0,6).join("\n"));
  }
})();
