"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only.
 *
 * Strategy: the worker calls `skipWaiting()` on install and `clients.claim()`
 * on activate, so a new deploy takes over without a waiting hand-off and
 * without reloading the page. The registration still checks for updates on
 * load and whenever the tab becomes visible, so a long-lived tab picks up the
 * new worker; the next navigation then uses the new build.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let disposed = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (disposed) return;
        await registration.update().catch(() => undefined);
      } catch (error) {
        // Private mode, a blocked worker or an unsupported browser: the site
        // must keep working without a worker.
        console.warn("[pwa] service worker not registered", error);
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.serviceWorker
        .getRegistration("/")
        .then((registration) => registration?.update())
        .catch(() => undefined);
    };

    const start = () => {
      void register();
      document.addEventListener("visibilitychange", onVisible);
    };

    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
