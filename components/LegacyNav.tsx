"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * TODO(task-8): remove this secondary nav when the old routes are retired.
 *
 * The Shambles header replaced the old NavLinks. Until the landing, profile and
 * niche pages replace /start, /room, /discover, /ideas and /weekly, this thin
 * row keeps those pages reachable. The rules are the old NavLinks rules:
 * plan-less visitors get Start and Explore; a saved plan gets Explore, This
 * week, Your reels and Check another handle. A signed-in visitor on the plan
 * home keeps the plan links too.
 */
const LEGACY_ROUTES = new Set([
  "/start",
  "/room",
  "/discover",
  "/ideas",
  "/weekly",
]);

const LINK =
  "inline-flex min-h-[44px] shrink-0 items-center rounded-md px-2 transition hover:text-pure-white";

export default function LegacyNav({ hasPlan }: { hasPlan: boolean }) {
  const pathname = usePathname();
  if (!pathname) return null;

  const planHome = pathname === "/" && hasPlan;
  if (!LEGACY_ROUTES.has(pathname) && !planHome) return null;

  return (
    <nav
      aria-label="Legacy pages"
      className="border-b border-white/10 bg-obsidian/60"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-5 py-1 text-[11px] text-muted-zinc">
        {!hasPlan ? (
          <Link
            href="/start"
            className={`${LINK} font-medium text-limelight`}
          >
            Start
          </Link>
        ) : null}
        <Link href="/discover" className={LINK}>
          Explore
        </Link>
        {hasPlan ? (
          <>
            <Link href="/weekly" className={LINK}>
              This week
            </Link>
            <Link href="/ideas" className={LINK}>
              Your reels
            </Link>
            <Link
              href="/?new=1"
              aria-label="Check a different handle"
              className={LINK}
            >
              <span className="hidden sm:inline">Check another handle</span>
              <span className="sm:hidden">Another</span>
            </Link>
          </>
        ) : null}
      </div>
    </nav>
  );
}
