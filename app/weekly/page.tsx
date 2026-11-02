import Link from "next/link";
import { Suspense } from "react";

import WeeklyRefresh from "@/components/WeeklyRefresh";
import WeeklyView from "@/components/WeeklyView";
import { currentAccount } from "@/lib/session";
import { mondayOf } from "@/lib/weekly";

export const instant = false;

export const metadata = {
  title: "This week — Creators 101",
  description:
    "What moved on your account since last Monday, the moves to make in order, and the posts to make them with.",
};

/**
 * The Monday page: one week's answer, kept.
 *
 * Read-only. Nobody pays for a page view — a digest is built by the weekly job
 * or by the button, and this page only renders whatever was recorded. That is
 * also why an old digest is shown as old rather than silently refreshed: a
 * number that changes while you are reading it cannot be trusted with a plan.
 *
 * The account is read from a cookie, and `cacheComponents` is on, so that read
 * has to happen inside a Suspense boundary. Without one Next bakes whatever the
 * page rendered at build time — which is the "nothing to show yet" state, with
 * no cookie — into the static shell and serves it to everyone, signed in or not.
 */
export default function WeeklyPage() {
  return (
    <Suspense fallback={<WeeklySkeleton />}>
      <RecordedWeek />
    </Suspense>
  );
}

function WeeklySkeleton() {
  return (
    <div className="space-y-4 py-6">
      <h1 className="text-[19px] font-semibold tracking-tight">This week</h1>
      <p className="text-[13.5px] leading-relaxed text-muted">Reading your week…</p>
    </div>
  );
}

async function RecordedWeek() {
  /** A DB blip shows the empty state, not a 500 for a signed-in visitor. */
  const account = await currentAccount().catch((err) => {
    const message = (err as Error).message;
    // `cookies()` always rejects at the end of prerendering; that is not a
    // database failure and logging it would make every build look broken.
    if (!/prerender/i.test(message)) {
      console.error("[weekly] session read failed:", message);
    }
    return null;
  });
  const plan = account ? await account.store.getPlan() : null;
  const history = account ? await account.store.getWeekly() : [];
  const digest = history[0] ?? null;

  if (!account || !plan) {
    return (
      <div className="space-y-4 py-6">
        <h1 className="text-[19px] font-semibold tracking-tight">This week</h1>
        <p className="text-[13.5px] leading-relaxed text-muted">
          There is nothing to show yet. Analyse a handle once and every Monday after that gets a
          week here — what moved, and what to post about it.
        </p>
        <Link
          href="/"
          className="inline-flex min-h-[40px] items-center rounded-lg bg-accent px-4 text-[13px] font-semibold text-bg"
        >
          Analyse your handle
        </Link>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="space-y-4 py-6">
        <h1 className="text-[19px] font-semibold tracking-tight">
          @{plan.handle}
          <span className="ml-2 text-[13px] font-normal text-muted">this week</span>
        </h1>
        <p className="text-[13.5px] leading-relaxed text-muted">
          Your account has been read, but no week has been recorded yet. Make this week's one — it
          is what next Monday gets compared against.
        </p>
        <WeeklyRefresh label="Make this week's plan" />
      </div>
    );
  }

  const stale = digest.weekOf !== mondayOf();

  return (
    <WeeklyView digest={digest} history={history} stale={stale}>
      {stale ? <WeeklyRefresh label="Pull this week" /> : null}
    </WeeklyView>
  );
}
