import Link from "next/link";

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
 */
export default async function WeeklyPage() {
  const account = await currentAccount();
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
