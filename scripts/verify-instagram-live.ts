/**
 * Live verification for the Instagram-only data layer.
 *
 * One real handle, one real niche, one measured bill. This is the only place
 * after the fixture capture that is allowed to spend HikerAPI calls, so it is
 * deliberately conservative:
 *
 *   - it refuses to start without HIKERAPI_KEY;
 *   - it prints the call cap before doing anything and installs a fetch guard
 *     that aborts *before* the request that would cross it;
 *   - it prints the HikerAPI balance before and after, so "calls used" is the
 *     vendor's own number rather than an estimate;
 *   - it never prints a key, a token, or a signed CDN URL.
 *
 * Compile and run like the other tagged scripts:
 *
 *   npx tsc scripts/verify-instagram-live.ts --module commonjs --target es2022 \
 *     --moduleResolution node --outDir .tmp-build --skipLibCheck \
 *     --esModuleInterop --lib es2022,dom --types node
 *
 *   CREATORS_DATA_DIR=/Users/pranav/reel-engine/data \
 *   NICHE_CACHE_HOURS=168 HANDLE_CACHE_HOURS=168 \
 *   node --env-file=.env.local .tmp-build/scripts/verify-instagram-live.js \
 *     _shravyapawar_ "kannada songs" --cap 40
 *
 * Warm a niche so the founder can open it for free:
 *
 *   ... .tmp-build/scripts/verify-instagram-live.js --warm "telugu songs cover" --cap 12
 *
 * `--force` re-reads a warm niche instead of serving it from disk.
 */
import { COSTS } from "../lib/costs";
import { researchNiche } from "../lib/niche";
import { instagramPeers } from "../lib/peers";
import { analyseHandle } from "../lib/plan";
import { creditLedger } from "../lib/providers";
import type { RawReel } from "../lib/types";

const HIKERAPI = "https://api.hikerapi.com";
const APIFY = "https://api.apify.com";

/** The real fetch, kept so the balance probe never counts against the cap. */
const nativeFetch = globalThis.fetch.bind(globalThis);

interface Args {
  handle?: string;
  niche?: string;
  warm?: string;
  cap: number;
  force: boolean;
  /** render the plan from the handle/niche cache instead of re-buying it */
  cached: boolean;
  peers: boolean;
}

function usage(): never {
  console.error(
    "usage: verify-instagram-live <handle> <niche> [--cap N] [--no-peers]\n" +
      "       verify-instagram-live --warm <niche> [--cap N] [--force]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { cap: 40, force: false, cached: false, peers: true };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cap") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 1) usage();
      args.cap = Math.floor(n);
    } else if (a === "--warm") {
      args.warm = argv[++i];
      if (!args.warm) usage();
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--cached") {
      args.cached = true;
    } else if (a === "--no-peers") {
      args.peers = false;
    } else if (a.startsWith("--")) {
      usage();
    } else {
      rest.push(a);
    }
  }
  if (!args.warm) {
    args.handle = rest[0];
    args.niche = rest[1];
    if (!args.handle || !args.niche) usage();
  }
  return args;
}

/** Strip a query string and any fragment: CDN links carry signatures there. */
function stripQuery(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/** Replace secrets and signed query strings before printing vendor text. */
function safe(text: string): string {
  let out = text;
  for (const name of ["HIKERAPI_KEY", "APIFY_TOKEN"] as const) {
    const value = process.env[name];
    if (value && value.length >= 6) out = out.split(value).join("[redacted]");
  }
  return out.replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/g, "$1");
}

function usdPerCall(): number {
  const n = Number(process.env.HIKERAPI_USD_PER_CALL ?? 0.02);
  return Number.isFinite(n) && n >= 0 ? n : 0.02;
}

/** HikerAPI's own remaining-call count. Free, and never counted by the guard. */
async function hikerBalance(): Promise<number | null> {
  const key = process.env.HIKERAPI_KEY;
  if (!key) return null;
  try {
    const res = await nativeFetch(`${HIKERAPI}/sys/balance`, {
      headers: { "x-access-key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const n = Number(json.requests ?? json.balance ?? json.amount);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Which billable vendor endpoint a URL is.
 *
 * Balance checks are free and are not part of the call budget, so they are
 * excluded. Everything else on the two vendor hosts is counted, including a
 * retry: a 5xx may not be billable, but counting it is the conservative answer.
 */
function vendorEndpoint(url: string): { vendor: string; endpoint: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin === HIKERAPI) {
    if (parsed.pathname.startsWith("/sys/")) return null;
    return { vendor: "hikerapi", endpoint: parsed.pathname };
  }
  if (parsed.origin === APIFY) {
    return { vendor: "apify", endpoint: parsed.pathname };
  }
  return null;
}

interface Tally {
  calls: number;
  byEndpoint: Map<string, number>;
  byVendor: Map<string, number>;
}

/**
 * Install the cap guard for the rest of the process.
 *
 * The guard aborts by exiting, not by throwing: plenty of the data layer's
 * catch blocks deliberately swallow a vendor failure and carry on with fewer
 * rows. Letting the cap exception be swallowed would make the script look like
 * it finished while it had actually stopped spending. Exiting before the
 * request guarantees the cap is never crossed and the message is unambiguous.
 */
function installGuard(cap: number): Tally {
  const tally: Tally = { calls: 0, byEndpoint: new Map(), byVendor: new Map() };
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const hit = vendorEndpoint(url);
    if (hit) {
      if (tally.calls >= cap) {
        console.error(
          `\nSTOP: live call cap reached before ${hit.vendor} ${hit.endpoint}.`,
        );
        console.error(
          `calls used: ${tally.calls} (cap ${cap}). No further vendor request was sent.`,
        );
        console.error(`by vendor: ${JSON.stringify(Object.fromEntries(tally.byVendor))}`);
        console.error(`by endpoint: ${JSON.stringify(Object.fromEntries(tally.byEndpoint))}`);
        process.exit(3);
      }
      tally.calls += 1;
      tally.byEndpoint.set(
        hit.endpoint,
        (tally.byEndpoint.get(hit.endpoint) ?? 0) + 1,
      );
      tally.byVendor.set(hit.vendor, (tally.byVendor.get(hit.vendor) ?? 0) + 1);
    }
    return nativeFetch(input, init);
  }) as typeof fetch;
  return tally;
}

function uniqueRows(...lists: (RawReel[] | undefined)[]): RawReel[] {
  const seen = new Set<string>();
  const out: RawReel[] = [];
  for (const list of lists) {
    for (const row of list ?? []) {
      const key = row.id || row.url || `${row.account}:${row.views}:${row.caption}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function platformShare(rows: RawReel[]): { instagram: number; total: number; share: number } {
  const instagram = rows.filter((r) => r.platform === "instagram").length;
  return {
    instagram,
    total: rows.length,
    share: rows.length ? instagram / rows.length : 0,
  };
}

function printLedger(start: { usd: number; spent: number }): void {
  const ledger = creditLedger();
  console.log("\n--- vendor ledger (creditLedger) ---");
  console.log(`logical calls in the last segment: ${ledger.calls}`);
  console.log(`vendor units in the last segment: ${ledger.spent}`);
  console.log(`by endpoint: ${JSON.stringify(ledger.byEndpoint)}`);
  console.log(`by vendor:   ${JSON.stringify(ledger.byVendor)}`);
  console.log(
    `USD, whole run (lifetimeUsd delta): $${(ledger.lifetimeUsd - start.usd).toFixed(4)}`,
  );
  console.log(
    `vendor units, whole run (lifetimeSpent delta): ${ledger.lifetimeSpent - start.spent}`,
  );
}

function printTally(tally: Tally): void {
  console.log("\n--- vendor requests counted by the cap guard ---");
  console.log(`total: ${tally.calls}`);
  console.log(`by vendor: ${JSON.stringify(Object.fromEntries(tally.byVendor))}`);
  console.log(`by endpoint: ${JSON.stringify(Object.fromEntries(tally.byEndpoint))}`);
}

function warmupReport(label: string, research: Awaited<ReturnType<typeof researchNiche>>): void {
  const rows = research.payload ?? [];
  const share = platformShare(rows);
  console.log(`\n--- ${label} ---`);
  console.log(`query: "${research.query}"`);
  console.log(`cached: ${research.cached} · fetchedAt: ${research.fetchedAt}`);
  console.log(
    `rows: ${rows.length} · accounts: ${research.accounts.length} · platform instagram: ` +
      `${share.instagram}/${share.total} (${(share.share * 100).toFixed(1)}%)`,
  );
  console.log(
    `credits the user would be charged: ${research.cached ? 0 : COSTS.niche}`,
  );
  console.log(
    `errors: ${research.errors.length ? research.errors.map(safe).join(" · ") : "none"}`,
  );
}

async function warm(args: Args, tally: Tally): Promise<void> {
  const before = creditLedger();
  const balanceBefore = await hikerBalance();
  console.log("=== Live verification — cache warm ===");
  console.log(`niche: "${args.warm}"`);
  console.log(`data dir: ${process.env.CREATORS_DATA_DIR ?? "(default ./data)"}`);
  console.log(
    `cache: NICHE_CACHE_HOURS=${process.env.NICHE_CACHE_HOURS ?? "(default 12)"}`,
  );
  console.log(`call cap: ${args.cap} (the script refuses to cross it)`);
  if (balanceBefore !== null) console.log(`hikerapi calls left before: ${balanceBefore}`);

  try {
    const research = await researchNiche({
      query: args.warm!,
      force: args.force && !args.cached,
    });
    warmupReport("niche", research);
  } catch (err) {
    console.error(`\nFAILED: ${safe((err as Error).message)}`);
    printTally(tally);
    printLedger({ usd: before.lifetimeUsd, spent: before.lifetimeSpent });
    const balanceAfter = await hikerBalance();
    if (balanceBefore !== null && balanceAfter !== null) {
      console.log(`hikerapi calls used (balance delta): ${balanceBefore - balanceAfter}`);
    }
    process.exit(1);
  }

  printTally(tally);
  const balanceAfter = await hikerBalance();
  if (balanceBefore !== null && balanceAfter !== null) {
    console.log(`hikerapi calls used (balance delta): ${balanceBefore - balanceAfter}`);
  }
  printLedger({ usd: before.lifetimeUsd, spent: before.lifetimeSpent });
}

async function handleRun(args: Args, tally: Tally): Promise<void> {
  const before = creditLedger();
  const balanceBefore = await hikerBalance();

  console.log("=== Live verification — one full plan ===");
  console.log(`handle: @${args.handle}`);
  console.log(
    `niche: "${args.niche}" (${args.cached ? "cached read" : "forced fresh read"})`,
  );
  console.log(`data dir: ${process.env.CREATORS_DATA_DIR ?? "(default ./data)"}`);
  console.log(
    `cache: NICHE_CACHE_HOURS=${process.env.NICHE_CACHE_HOURS ?? "(default 12)"} ` +
      `HANDLE_CACHE_HOURS=${process.env.HANDLE_CACHE_HOURS ?? "(default 12)"}`,
  );
  console.log(`hikerapi rate: $${usdPerCall().toFixed(3)} per call`);
  console.log(`call cap: ${args.cap} (the script refuses to cross it)`);
  if (balanceBefore !== null) console.log(`hikerapi calls left before: ${balanceBefore}`);
  console.log("");

  let result: Awaited<ReturnType<typeof analyseHandle>>;
  try {
    result = await analyseHandle(args.handle!, {
      force: !args.cached,
      niche: args.niche,
    });
  } catch (err) {
    console.error(`\nFAILED: ${safe((err as Error).message)}`);
    printTally(tally);
    printLedger({ usd: before.lifetimeUsd, spent: before.lifetimeSpent });
    const balanceAfter = await hikerBalance();
    if (balanceBefore !== null && balanceAfter !== null) {
      console.log(`hikerapi calls used (balance delta): ${balanceBefore - balanceAfter}`);
    }
    process.exit(1);
  }

  const plan = result.plan;
  const rows = uniqueRows(result.own.reels, result.research.payload, result.seedReels);
  const share = platformShare(rows);
  const withViews = rows.filter((r) => (r.views ?? 0) > 0).length;

  console.log("--- plan ---");
  console.log(`platform: ${plan.platform ?? "unknown"}`);
  console.log(
    `own: ${result.own.reels.length} reels · ${plan.standing.followers ?? "?"} followers · ` +
      `niche source "${result.niche.source}"`,
  );
  console.log(
    `cohort: ${plan.cohort.accounts} accounts · platform ${plan.cohort.platform ?? "?"} · ` +
      `sizeMatched ${plan.cohort.sizeMatched} · basis "${safe(plan.cohort.basis)}"`,
  );
  console.log(
    `platform share: ${share.instagram}/${share.total} rows are instagram ` +
      `(${(share.share * 100).toFixed(1)}%) ${share.share === 1 ? "PASS" : "FAIL"}`,
  );
  console.log(`rows with views: ${withViews}/${rows.length}`);
  console.log(`niche fit: ${result.nicheFit.verdict} (${safe(result.nicheFit.reasons.join("; "))})`);

  const evidence = [...result.seedReels]
    .filter((r) => Boolean(r.url))
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 3);
  console.log("first three evidence post URLs:");
  for (const r of evidence) console.log(`  ${stripQuery(r.url!)}`);

  const planHiker = tally.byVendor.get("hikerapi") ?? 0;
  const planApify = tally.byVendor.get("apify") ?? 0;
  console.log(
    `\nplan completed: hikerapi ${planHiker} calls · apify ${planApify} runs · ` +
      `hikerapi cost $${(planHiker * usdPerCall()).toFixed(4)} at $${usdPerCall().toFixed(3)}/call`,
  );
  console.log(`credits a user would be charged: ${COSTS.handle}`);

  /**
   * Task 4's peers are only bought by the plan when a room has to be rebuilt on
   * Instagram; an Instagram-only search never triggers that rebuild. Verify the
   * module directly against the rows the niche already bought, with a small
   * read cap, so reasons and sources are exercised live without re-buying the
   * plan.
   */
  if (args.peers) {
    console.log("\n--- peers (Task 4 module, live) ---");
    try {
      const peers = await instagramPeers({
        handle: result.own.handle,
        followers: plan.standing.followers,
        query: result.niche.query,
        reels: result.seedReels,
        max: 3,
      });
      console.log(
        `peers: ${peers.accounts.length} · sizeMatched ${peers.sizeMatched} · ` +
          `cost $${peers.cost.usd.toFixed(4)} · basis "${safe(peers.basis)}"`,
      );
      for (const peer of peers.accounts) {
        console.log(
          `  @${peer.handle} · source=${peer.source} · followers=${peer.followers ?? "?"} · ` +
            `reels=${peer.reels} · median views=${peer.medianViews}`,
        );
        console.log(`    reasons: ${peer.reasons.map(safe).join("; ")}`);
      }
      if (peers.errors.length) {
        console.log(`  source errors: ${peers.errors.map(safe).join(" · ")}`);
      }
    } catch (err) {
      console.log(`peers failed: ${safe((err as Error).message)}`);
    }
  }

  printTally(tally);

  const balanceAfter = await hikerBalance();
  if (balanceBefore !== null && balanceAfter !== null) {
    console.log(`hikerapi calls used (balance delta): ${balanceBefore - balanceAfter}`);
  } else {
    console.log(`hikerapi calls used: ${tally.byVendor.get("hikerapi") ?? 0} (guard count)`);
  }
  printLedger({ usd: before.lifetimeUsd, spent: before.lifetimeSpent });
  const hikerCalls = tally.byVendor.get("hikerapi") ?? 0;
  console.log(
    `\nwhole verification: hikerapi ${hikerCalls} calls · apify ${tally.byVendor.get("apify") ?? 0} runs`,
  );
  console.log(
    `hikerapi cost at $0.020/call: $${(hikerCalls * 0.02).toFixed(4)} (${hikerCalls} calls)`,
  );
  console.log(
    `hikerapi cost at $0.001/call: $${(hikerCalls * 0.001).toFixed(4)} (${hikerCalls} calls)`,
  );

  if (share.share !== 1) {
    console.error("\nFAIL: not every row is platform === \"instagram\".");
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (!process.env.HIKERAPI_KEY) {
    console.error("HIKERAPI_KEY is missing — refusing to make live calls.");
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const tally = installGuard(args.cap);
  if (args.warm) await warm(args, tally);
  else await handleRun(args, tally);
}

main().catch((err) => {
  console.error(`FAILED: ${safe((err as Error).message)}`);
  process.exit(1);
});
