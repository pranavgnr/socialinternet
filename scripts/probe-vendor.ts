/**
 * Is the configured vendor actually working — and does it return the fields the
 * ranking maths needs?
 *
 * Every adapter in lib/providers was written against a vendor's published docs
 * and none of them can be trusted until a live key has been through this. It
 * exists because the previous failure mode was shipping an adapter that looked
 * right, cost real money, and silently mapped the wrong field: the plan then
 * rendered with zero views and blamed the account.
 *
 * Costs real money: three calls per vendor (about $0.02 total on SocialCrawl).
 *
 *   npx tsx --env-file=.env.local scripts/probe-vendor.ts            # balance only, free
 *   npx tsx --env-file=.env.local scripts/probe-vendor.ts --live     # spend 3 calls
 *   npx tsx --env-file=.env.local scripts/probe-vendor.ts --live @natgeo
 */
import { availableProviders, providerSummary } from "../lib/providers";

const args = process.argv.slice(2);
const live = args.includes("--live");
const handle = (args.find((a) => !a.startsWith("--")) ?? "natgeo").replace(/^@/, "");

/** Fields the pipeline cannot do without, checked on a real row. */
function fieldCheck(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "!! NO ROWS — adapter mapping is wrong or the vendor returned nothing";
  const first = rows[0];
  const flat = JSON.stringify(first);
  const has = (re: RegExp) => (re.test(flat) ? "yes" : "MISSING");
  return [
    `rows=${rows.length}`,
    `code=${has(/"code"/)}`,
    `caption=${has(/"caption"/)}`,
    `views=${has(/"views"/)}`,
    `likes=${has(/"likes"/)}`,
    `account=${has(/"account"/)}`,
  ].join(" · ");
}

async function main() {
  console.log("=== configured vendors ===");
  for (const p of providerSummary()) {
    console.log(`  ${p.id.padEnd(12)} configured=${p.configured}  ${p.cost.label}`);
    if (p.benched) console.log(`    benched: ${p.benched}`);
  }

  const providers = availableProviders();
  if (!providers.length) {
    console.log("\nNo vendor configured. Add SOCIALCRAWL_API_KEY or HIKERAPI_KEY to .env.local.");
    return;
  }

  console.log(`\n=== balance (free) ===`);
  for (const p of providers) {
    const b = await p.balance();
    console.log(
      `  ${p.id.padEnd(12)} ${b.ok ? `${b.remaining} ${b.unit} left` : `FAILED: ${b.error}`}`,
    );
  }

  if (!live) {
    console.log("\nDry run: no paid calls made. Re-run with --live to validate the mapping.");
    return;
  }

  for (const p of providers) {
    console.log(`\n=== ${p.id} · live calls against @${handle} ===`);
    try {
      const prof = await p.profile(handle);
      const user = (prof.data.user ?? {}) as Record<string, unknown>;
      console.log(
        `  profile      ${prof.units} unit(s) · followers=${user.follower_count ?? "?"} · category=${user.category ?? "-"}`,
      );
    } catch (e) {
      console.log(`  profile      FAILED: ${(e as Error).message}`);
    }

    try {
      const reels = await p.profileReels(handle);
      const rows = (reels.data.reels ?? reels.data.data ?? []) as Record<string, unknown>[];
      console.log(`  profileReels ${reels.units} unit(s) · ${fieldCheck(rows)}`);
    } catch (e) {
      console.log(`  profileReels FAILED: ${(e as Error).message}`);
    }

    try {
      const search = await p.searchReels("home workout");
      const rows = (search.data.reels ?? search.data.data ?? []) as Record<string, unknown>[];
      console.log(`  searchReels  ${search.units} unit(s) · ${fieldCheck(rows)}`);
    } catch (e) {
      console.log(`  searchReels  FAILED: ${(e as Error).message}`);
    }
  }
}

main();
