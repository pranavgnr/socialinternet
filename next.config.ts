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
};

export default nextConfig;
