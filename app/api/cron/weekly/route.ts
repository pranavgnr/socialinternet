import { NextResponse } from "next/server";

import { listAccounts, mondayOf, runWeekly, storeAt, dataRoot } from "@/lib/weekly";

export const maxDuration = 800;

/**
 * GET /api/cron/weekly?secret=…  (or header `x-cron-secret`)
 *
 * The Monday job: for every account that has ever had a plan, re-read it and
 * record what changed. Nothing here is free — each account is a real pull — so
 * it is capped, sequential, and skips anyone whose week is already recorded.
 *
 * A failing account never stops the rest: one dead handle must not cost the
 * other creators their Monday.
 */
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Set CRON_SECRET to enable the weekly job." },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const given = req.headers.get("x-cron-secret") ?? url.searchParams.get("secret") ?? "";
  if (given !== secret) {
    return NextResponse.json({ ok: false, error: "Bad secret." }, { status: 401 });
  }

  const week = mondayOf();
  const cap = Number(process.env.WEEKLY_MAX ?? 3);
  const forceWeek = url.searchParams.get("force") === "1";

  /** `?handle=x` refreshes one account — how a single creator is fixed by hand. */
  const only = url.searchParams.get("handle")?.replace(/^@/, "").toLowerCase();
  const accounts = (await listAccounts(dataRoot())).filter(
    (a) => !only || a.handle.toLowerCase() === only,
  );
  const done: string[] = [];
  const skipped: string[] = [];
  const failed: { id: string; handle: string; error: string }[] = [];

  for (const account of accounts) {
    if (done.length >= cap) {
      skipped.push(account.handle);
      continue;
    }

    const db = storeAt(account.dir);
    const history = await db.getWeekly();
    if (!forceWeek && history.some((d) => d.weekOf === week)) {
      skipped.push(account.handle);
      continue;
    }

    try {
      const { digest } = await runWeekly(account.handle, db);
      done.push(`${digest.handle} (${digest.ideas.length} ideas)`);
    } catch (err) {
      failed.push({ id: account.id, handle: account.handle, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    week,
    accounts: accounts.length,
    done,
    skipped,
    failed,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
