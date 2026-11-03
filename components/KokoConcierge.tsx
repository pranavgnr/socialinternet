"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { kokoHref } from "@/lib/omni";

/**
 * The floating concierge. Obsidian pill, a breathing lime aura (gold on VIP
 * pages), a small vector face and the always-on line. Hidden inside the chat
 * itself, because the studio is already there.
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
      aria-label="Chat with Koko, your AI director"
      className={`koko-aura group fixed bottom-6 right-6 z-50 inline-flex items-center gap-3 rounded-full border border-white/10 bg-card/95 px-3 py-2 backdrop-blur transition hover:border-white/20 ${className}`}
      style={style}
    >
      <svg
        viewBox="0 0 32 32"
        className="h-9 w-9 shrink-0"
        aria-hidden="true"
      >
        <rect
          x="2.5"
          y="2.5"
          width="27"
          height="27"
          rx="10"
          fill="#131318"
          stroke={accent}
          strokeOpacity="0.55"
        />
        <rect x="9" y="11" width="4.5" height="5.5" rx="1.2" fill={accent} />
        <rect x="18.5" y="11" width="4.5" height="5.5" rx="1.2" fill={accent} />
        <rect x="11.5" y="21" width="9" height="2.6" rx="1.3" fill="#FAFAFA" />
      </svg>
      <span className="flex flex-col pr-1 leading-tight">
        <span className="text-[13px] font-semibold text-pure-white">Koko</span>
        <span className="mono text-[10px] tracking-[0.06em] text-muted-zinc">
          <span style={{ color: accent }} aria-hidden="true">
            ●
          </span>{" "}
          Online · AI Director
        </span>
      </span>
    </Link>
  );
}
