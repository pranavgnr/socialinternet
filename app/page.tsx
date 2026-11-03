import { connection } from "next/server";

import ChatPanel from "@/components/ChatPanel";
import Landing from "@/components/Landing";
import PlanView from "@/components/PlanView";
import { currentUser } from "@/lib/auth";
import { currentAccount } from "@/lib/session";

export const instant = false;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; niche?: string }>;
}) {
  await connection();
  const [{ new: isNew }, user] = await Promise.all([
    searchParams,
    /**
     * A database outage must not take the front door down: the landing page is
     * still useful to a signed-out visitor, and a 500 here would hide it. The
     * failure is logged once, without the cookie or any connection string.
     */
    currentUser().catch((err) => {
      console.error("[home] session read failed:", (err as Error).message);
      return null;
    }),
  ]);

  const account = user ? await currentAccount() : null;
  const stored = account ? await account.store.getPlan() : null;

  /**
   * Plans written before the archetype existed have no shape to show, and their
   * advice was written for nobody in particular. Rather than render half a page
   * or crash on a missing field, they are treated as absent: the visitor is
   * shown the landing page and asked for a handle, and gets a plan that is
   * actually about them.
   */
  const plan = stored?.archetype ? stored : null;

  /**
   * TODO(task-4): once `/profile/[handle]` exists, a signed-in visitor with a
   * saved plan goes there (`/profile/${plan.handle}`) instead of seeing the old
   * dashboard. The route does not exist on this branch yet, so the dashboard
   * stays as the working fallback until Task 4 lands. `?new=1` deliberately
   * falls through to the landing page so a plan holder can audit another
   * handle.
   */
  if (user && plan && !isNew) {
    return (
      <div className="space-y-6">
        <PlanView plan={plan} />
        <ChatPanel />
      </div>
    );
  }

  return <Landing signedIn={Boolean(user)} />;
}
