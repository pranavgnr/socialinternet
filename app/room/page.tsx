import Link from "next/link";
import { connection } from "next/server";

import RoomBuilder from "@/components/RoomBuilder";
import RoomPlanView from "@/components/RoomPlanView";
import { currentAccount } from "@/lib/session";

export const instant = false;

export const metadata = {
  title: "Your first posts — Creators 101",
  description:
    "No handle needed. Type a space and get the first posts to make there, built from what is already winning — and whether accounts your size are the ones winning.",
};

/**
 * A room plan is built for a space, not for a handle, so it can be linked
 * directly: "/room?q=south indian recipes" is a shareable answer.
 *
 * When the visitor already has one for this phrase it is rendered from disk, so
 * going back to it is instant and costs nothing. Otherwise the client builds it,
 * because researching a room is real work and must never happen during a page
 * render — a refresh, a back button or a link preview would pay for it.
 */
export default async function RoomPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await connection();

  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const account = await currentAccount();
  const saved = account ? await account.store.getRoom() : null;

  if (saved && query && saved.query.toLowerCase() === query.toLowerCase()) {
    return (
      <div className="space-y-6">
        <RoomPlanView room={saved} />
        <p className="text-center text-[11.5px] text-muted/60">
          <Link
            href={`/discover?q=${encodeURIComponent(saved.query)}`}
            className="underline decoration-line underline-offset-2 hover:text-text"
          >
            See the accounts behind this
          </Link>
        </p>
      </div>
    );
  }

  return <RoomBuilder query={query} />;
}
