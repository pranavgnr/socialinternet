"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import {
  isInstallable,
  isIosSafari,
  nextVisit,
  shouldShowInstallPrompt,
  type VisitRecord,
} from "@/lib/pwa";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const VISIT_KEY = "shambles:install-visits";
const DISMISS_KEY = "shambles:install-dismissed";
const PROFILE_KEY = "shambles:install-profile-opened";

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readVisits(): VisitRecord | null {
  try {
    const raw = window.localStorage.getItem(VISIT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { day?: string; count?: number };
    if (typeof parsed.day !== "string" || typeof parsed.count !== "number") {
      return null;
    }
    return { day: parsed.day, count: parsed.count };
  } catch {
    return null;
  }
}

/**
 * Count one visit per calendar day. The first visit is 1, so the bar appears on
 * the second distinct day (or earlier after opening a profile); a reload on the
 * same day does not count twice.
 */
function bumpVisit(): number {
  const next = nextVisit(readVisits(), today());
  try {
    window.localStorage.setItem(VISIT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: no repeat prompt, but the site keeps working.
  }
  return next.count;
}

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * A small, dismissible install bar.
 *
 * It shows on phones only: after the second *day* of visits or once a profile
 * has been opened. iOS Safari has no `beforeinstallprompt`, so it gets the
 * Share-sheet hint instead. A dismissal is remembered for 30 days, and the bar
 * never appears inside an installed (standalone) window or over the Koko
 * studio's composer. While visible, the page reserves bottom space and the bar
 * sits above the fixed Koko widget.
 */
export default function InstallPrompt() {
  const pathname = usePathname();
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    let disposed = false;

    const evaluate = () => {
      if (disposed) return;
      if (typeof window === "undefined") return;

      // The studio is a full-height composer; an install bar there would sit
      // over the text field. Wait for a calmer page.
      if (pathname === "/chat" || pathname?.startsWith("/chat/")) {
        setVisible(false);
        return;
      }

      const deviceInstallable = isInstallable(
        navigator.userAgent,
        navigator.maxTouchPoints || 0,
      );
      const mobile =
        deviceInstallable &&
        (window.matchMedia("(max-width: 767px)").matches ||
          window.matchMedia("(pointer: coarse)").matches);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;

      if (!mobile || standalone) {
        setVisible(false);
        return;
      }

      const visits = bumpVisit();
      let profileOpened = false;
      try {
        profileOpened =
          window.localStorage.getItem(PROFILE_KEY) === "1" ||
          Boolean(pathname?.startsWith("/profile/"));
        if (profileOpened) window.localStorage.setItem(PROFILE_KEY, "1");
      } catch {
        profileOpened = Boolean(pathname?.startsWith("/profile/"));
      }

      const allowed = shouldShowInstallPrompt({
        visits,
        profileOpened,
        dismissedAt: readNumber(DISMISS_KEY),
        now: Date.now(),
        standalone,
        mobile,
      });
      if (!allowed) {
        setVisible(false);
        return;
      }

      const onIos = isIosSafari(
        navigator.userAgent,
        navigator.maxTouchPoints || 0,
      );
      setIos(onIos);
      if (onIos || promptRef.current) {
        setVisible(true);
      } else {
        setVisible(false);
      }
    };

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
      evaluate();
    };

    const onStandaloneChange = () => evaluate();

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener?.("change", onStandaloneChange);

    evaluate();

    return () => {
      disposed = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      media.removeEventListener?.("change", onStandaloneChange);
    };
  }, [pathname]);

  /**
   * Reserve the bar's height at the end of the document. Fixed elements do not
   * contribute to layout, so without this the footer can hide behind it.
   */
  useEffect(() => {
    if (!visible) return;
    const previous = document.body.style.paddingBottom;
    const reserve = () => {
      const height = barRef.current?.offsetHeight ?? 84;
      document.body.style.paddingBottom = `${height + 92}px`;
    };
    reserve();
    window.addEventListener("resize", reserve);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(reserve)
        : null;
    if (observer && barRef.current) observer.observe(barRef.current);
    return () => {
      window.removeEventListener("resize", reserve);
      observer?.disconnect();
      document.body.style.paddingBottom = previous;
    };
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // The bar hides for this session even when storage is blocked.
    }
    setVisible(false);
  };

  const install = async () => {
    const event = promptRef.current;
    if (!event) return;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "dismissed") {
        try {
          window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
        } catch {
          // Nothing else to do.
        }
      }
    } catch {
      // A prompt can be invalidated by the browser; hiding is enough.
    } finally {
      promptRef.current = null;
      setVisible(false);
    }
  };

  return (
    <div
      ref={barRef}
      data-install-prompt
      role="status"
      aria-live="polite"
      aria-label="Install Shambles"
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+76px)] z-40 mx-auto max-w-md sm:bottom-[calc(env(safe-area-inset-bottom,0px)+96px)]"
      style={{
        left: "calc(0.75rem + env(safe-area-inset-left, 0px))",
        right: "calc(0.75rem + env(safe-area-inset-right, 0px))",
      }}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-card/95 p-2 pl-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        <img
          src="/icons/icon-192.png"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-lg"
        />
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-pure-white">
          <span className="block font-semibold">Install Shambles</span>
          <span className="block text-[11px] text-muted-zinc">
            {ios ? "Tap Share, then Add to Home Screen." : "Full screen, one tap from your home screen."}
          </span>
        </p>
        {!ios ? (
          <button
            type="button"
            onClick={() => void install()}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl bg-limelight px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-obsidian"
          >
            Install
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-[20px] leading-none text-muted-zinc transition hover:text-pure-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
