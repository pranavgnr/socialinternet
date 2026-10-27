import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
import { pullOwn, analyseHandle } from "../lib/plan";
import { harvestInstagramAccount } from "../lib/harvest";
async function main() {
  try {
    const r = await harvestInstagramAccount("mkbhd");
    console.log("IG harvest:", r.length, "rows; platforms:", [...new Set(r.map(x=>x.platform))]);
  } catch (e) { console.log("IG harvest THREW:", (e as Error).message); }
  try {
    const o = await pullOwn("mkbhd", true, "youtube");
    console.log("pullOwn youtube:", o.reels.length, "reels, platform", o.platform);
  } catch (e) { console.log("pullOwn youtube THREW:", (e as Error).message); }
  try {
    const a = await analyseHandle("mkbhd", { force: true });
    console.log("analyse:", a.own?.platform, a.own?.reels?.length, "plan.platform", a.plan.platform, "standing", JSON.stringify(a.plan.standing && {r:a.plan.standing.reelsRead, acc:a.plan.standing.accountRead}));
  } catch (e) { console.log("analyse THREW:", (e as Error).message); }
}
main();
