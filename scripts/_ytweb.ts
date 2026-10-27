import { youtubeweb } from "../lib/providers/youtubeweb";

async function main() {
  const t0 = Date.now();
  const res = await youtubeweb.searchReels("sourdough baking");
  const items = (res.data.items as Record<string, unknown>[]) ?? [];
  console.log("search ms", Date.now() - t0, "rows", items.length, "usd", res.usd);
  for (const row of items.slice(0, 8)) {
    const p = row.post as Record<string, any>;
    console.log(
      [
        p.author.username,
        p.author.followers ?? "-",
        p.engagement.views,
        p.content.text?.slice(0, 40),
      ].join(" | "),
    );
  }

  const t1 = Date.now();
  const ch = await youtubeweb.profileReels("GrantBakes");
  const cItems = (ch.data.items as Record<string, unknown>[]) ?? [];
  console.log("\nprofileReels ms", Date.now() - t1, "rows", cItems.length);
  for (const row of cItems.slice(0, 5)) {
    const p = row.post as Record<string, any>;
    const ratio = (row.computed as any)?.vs_creator?.ratio;
    console.log(
      [p.engagement.views, typeof ratio === "number" ? ratio.toFixed(2) + "x" : "-", p.content.text?.slice(0, 40)].join(" | "),
    );
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
