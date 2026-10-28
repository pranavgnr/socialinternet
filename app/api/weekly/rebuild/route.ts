import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { cachedCommentsByUrl, mineComments, normaliseUrl } from "@/lib/comments";
import { buildDigest, dataRoot, listAccounts, mondayOf, storeAt, upsertDigest } from "@/lib/weekly";

export const maxDuration = 120;

/**
 * POST /api/weekly/rebuild  (?account=<id> | ?all=1)
 *
 * Rewrites this week's digest from the data already on disk — the stored plan,
 * the stored ideas, and the comments in `_post_cache.json`. **Spends nothing:**
 * there is no provider call in here at all.
 *
 * Why it exists: the digest is a derived record, so when its shape improves —
 * a move that names the accounts behind it, a comment section that survives a
 * cache-only run — every week already recorded is still in the old shape and
 * would keep rendering the old, thinner answer. The alternative to this route
 * is a real re-pull per account, which costs credits to recompute facts that
 * are already paid for.
 *
 * Comments are re-mined as part of it, because the miner's own rules changed
 * (emoji and praise no longer count as asks). Re-mining reads the raw comments
 * the cache kept, so the cleaner ranking applies to weeks recorded before it.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = req.headers.get("x-cron-secret") ?? "";
    if (given !== secret) {
      return NextResponse.json({ ok: false, error: "Bad secret." }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const only = url.searchParams.get("account");
  const all = url.searchParams.get("all") === "1";
  if (!only && !all) {
    return NextResponse.json(
      { ok: false, error: "Pass ?account=<id> or ?all=1 — this rewrites stored weeks." },
      { status: 400 },
    );
  }

  const accounts = await listAccounts(dataRoot());
  const targets = only ? accounts.filter((a) => a.id === only) : accounts;
  if (only && !targets.length) {
    return NextResponse.json({ ok: false, error: "No account with that id." }, { status: 404 });
  }

  const week = mondayOf();
  const cached = cachedCommentsByUrl();
  const rebuilt: { handle: string; id: string; heard: number; peers: number; weekOf: string }[] = [];
  const skipped: { id: string; why: string }[] = [];

  for (const account of targets) {
    const store = storeAt(account.dir);
    const plan = await store.getPlan();
    if (!plan?.handle) {
      skipped.push({ id: account.id, why: "no plan" });
      continue;
    }

    /**
     * Re-mine only when the cache holds comments for this account's own reels.
     * Nothing cached, nothing changed — the section stays absent, which is the
     * truth, rather than being filled with a promise.
     */
    let signals: { url?: string }[] = [];
    try {
      signals = JSON.parse(await readFile(`${account.dir}/signals.json`, "utf8")) as {
        url?: string;
      }[];
    } catch {
      /* no signals file — no own reels to mine */
    }
    const own = signals
      .filter((s) => typeof s.url === "string")
      .map((s) => ({ url: s.url as string, comments: cached.get(normaliseUrl(s.url as string)) }));
    if (own.length) {
      const mining = mineComments(own);
      if (mining.read > 0) {
        plan.comments = mining;
        await store.savePlan(plan);
      }
    }

    const ideas = await store.getIdeas();
    const history = await store.getWeekly();
    // The comparison is against the last week that is not this one.
    const previous = history.find((d) => d.weekOf !== week);
    const digest = buildDigest({ plan, ideas, credits: 0, cached: true, previous });
    await store.saveWeekly(upsertDigest(history, digest));

    rebuilt.push({
      handle: plan.handle,
      id: account.id,
      heard: digest.heard?.asks.length ?? 0,
      peers: digest.peers.length,
      weekOf: digest.weekOf,
    });
  }

  return NextResponse.json({ ok: true, week, rebuilt, skipped });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
