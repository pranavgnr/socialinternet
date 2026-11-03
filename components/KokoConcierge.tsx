"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { kokoHref } from "@/lib/omni";
import KokoAvatar from "./koko/KokoAvatar";

/**
 * The floating concierge. On phones it is a 48 px icon-only circle so it does
 * not sit on top of the page's forms; from `sm` up it is the obsidian pill with
 * the breathing aura and the always-on line. Hidden inside the chat itself,
 * because the studio is already there.
 */
export default function KokoConcierge({
  tone = "lime",
  className = "",
}: {
  tone?: "lime" | "gold";
  className?: string;
}) {
  const pathname = usePathname();
  if (!pathname || pathname === "/chat" || pathname.startsWith("/chat/")) {
    return null;
  }

  const accent = tone === "gold" ? "#E5C158" : "#CCFF00";
  const rgb = tone === "gold" ? "229, 193, 88" : "204, 255, 0";
  const style = {
    "--koko-aura": `0 0 0 1px rgba(${rgb}, 0.20), 0 0 24px rgba(${rgb}, 0.18), 0 0 52px rgba(${rgb}, 0.07)`,
    "--koko-aura-strong": `0 0 0 1px rgba(${rgb}, 0.30), 0 0 34px rgba(${rgb}, 0.26), 0 0 78px rgba(${rgb}, 0.10)`,
  } as React.CSSProperties;

  return (
    <Link
      href={kokoHref(pathname)}
      prefetch={false}
      aria-label="Open Koko, your AI director"
      className={`koko-aura group fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-[calc(1rem+env(safe-area-inset-right,0px))] z-50 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-card/95 p-0 backdrop-blur transition hover:border-white/20 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:right-[calc(1.5rem+env(safe-area-inset-right,0px))] sm:h-auto sm:w-auto sm:justify-start sm:gap-3 sm:px-3 sm:py-2 ${className}`}
      style={style}
    >
      <KokoAvatar tone={tone} className="h-9 w-9" />
      <span className="hidden flex-col pr-1 leading-tight sm:flex">
        <span className="text-[13px] font-semibold text-pure-white">Koko</span>
        <span className="mono text-[11px] tracking-[0.06em] text-muted-zinc">
          <span style={{ color: accent }} aria-hidden="true">
            ●
          </span>{" "}
          Online · AI Director
        </span>
      </span>
    </Link>
  );
}
