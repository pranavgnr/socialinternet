import { connection } from "next/server";
import { redirect } from "next/navigation";

import Landing from "@/components/Landing";
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
   * A signed-in visitor with a saved plan belongs on their own profile, where
   * the whole audit lives. `?new=1` deliberately falls through to the landing
   * page so a plan holder can audit another handle. A plan without a handle has
   * no profile to open, so it also falls back to the landing page rather than
   * redirecting to `/profile/undefined`.
   */
  if (user && plan && !isNew && plan.handle) {
    redirect(`/profile/${encodeURIComponent(plan.handle)}`);
  }

  return <Landing signedIn={Boolean(user)} />;
}
