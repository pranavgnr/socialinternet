import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  /**
   * Testing from a phone means reaching this Mac by its LAN or Tailscale
   * address, not localhost. Next blocks dev-only resources for unknown origins
   * by default, which makes the site look broken on a phone, so the addresses
   * used for that are named here.
   */
  allowedDevOrigins: ["100.104.38.54", "*.local", "*.ts.net"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  /**
   * The worker updates itself through the registration code, so the browser
   * must revalidate `/sw.js` on every check rather than serving a cached copy
   * for the lifetime of the deploy. Scope is the whole origin.
   */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
