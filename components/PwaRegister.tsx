"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only.
 *
 * A new deployment installs a worker that waits behind the current one. We do
 * not reload the page (that would wipe a half-typed message); instead the
 * waiting worker is told to activate on `pagehide`, so the next navigation
 * arrives on the new build. Update checks run on load and when the tab becomes
 * visible again.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let disposed = false;

    const activateWaiting = (registration: ServiceWorkerRegistration) => {
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    };

    const watchInstalling = (registration: ServiceWorkerRegistration) => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state !== "installed") return;
        if (!navigator.serviceWorker.controller) return;
        // The old worker is still controlling this document. Let the visitor
        // finish what they are doing, then hand over on the way out.
        window.addEventListener(
          "pagehide",
          () => activateWaiting(registration),
          { once: true },
        );
      });
    };

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (disposed) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          window.addEventListener(
            "pagehide",
            () => activateWaiting(registration),
            { once: true },
          );
        }

        registration.addEventListener("updatefound", () =>
          watchInstalling(registration),
        );
        watchInstalling(registration);
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
