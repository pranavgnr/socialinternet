import { connection } from "next/server";

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
   * No redirect for plan holders. The logo links here, so forcing a signed-in
   * visitor onto their profile made the homepage unreachable. They see the same
   * front door as everyone else, plus a link back to their own audit.
   */
  const ownHandle = user && plan?.handle ? plan.handle : null;

  return <Landing signedIn={Boolean(user)} ownHandle={ownHandle} />;
}
