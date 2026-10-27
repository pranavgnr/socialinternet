import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
import { resolveIntent } from "../lib/nicheIntent";
async function main() {
  for (const p of process.argv.slice(2)) {
    const r = await resolveIntent(p, { force: true });
    console.log(`\n[${p}] via=${r.via} interests=${r.interests.join(",")}`);
    console.log("  rooms   :", r.rooms.map((x) => x.query).join(" | "));
    console.log("  adjacent:", r.adjacent.map((x) => x.query).join(" | "));
  }
}
main();
