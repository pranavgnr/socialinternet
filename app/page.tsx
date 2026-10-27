import Link from "next/link";
import { connection } from "next/server";

import ConnectHandle from "@/components/ConnectHandle";
import PlanView from "@/components/PlanView";
import { currentAccount } from "@/lib/session";

export const instant = false;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; niche?: string }>;
}) {
  await connection();
  const [{ new: isNew, niche }, account] = await Promise.all([
    searchParams,
    currentAccount(),
  ]);

  const stored = account ? await account.store.getPlan() : null;

  /**
   * Plans written before the archetype existed have no shape to show, and their
   * advice was written for nobody in particular. Rather than render half a page
   * or crash on a missing field, they are treated as absent: the visitor is
   * asked for a handle and gets a plan that is actually about them.
   */
  const plan = stored?.archetype ? stored : null;

  if (!plan || isNew) {
    return (
      <div className="space-y-4">
        {/* A niche arrived from discover, so the plan is built for that space. */}
        <ConnectHandle initialNiche={niche?.trim() || undefined} />
        {plan && isNew ? (
          <p className="text-center text-[12px] text-muted">
            <Link
              href="/"
              className="underline decoration-line underline-offset-2 hover:text-text"
            >
              back to @{plan.handle}&rsquo;s plan
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  /**
   * The page is the plan and nothing else.
   *
   * Two sections were removed for launch: a "what's working" list built from
   * shared keywords (it restated the moves in worse words, and its labels read
   * like machine output), and an "update this plan" button (a maintenance
   * control that spends a paid re-pull — the plan refreshes on its own).
   */
  return (
    <div className="space-y-6">
      <PlanView plan={plan} />
    </div>
  );
}
