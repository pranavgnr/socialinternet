import type { MetadataRoute } from "next";

/**
 * The installable app description. Colours come from the founder tokens:
 * obsidian canvas, limelight mark, pure-white type.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Shambles",
    short_name: "Shambles",
    description:
      "The AI director for Instagram creators: a real account audit, what is working in your niche, and the next posts worth making.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090C",
    theme_color: "#09090C",
    lang: "en",
    categories: ["social", "productivity", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Search a niche",
        short_name: "Search",
        description: "Find what is working in an Instagram niche",
        url: "/",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
      {
        name: "Koko",
        short_name: "Koko",
        description: "Open Koko, your AI director",
        url: "/chat",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
        ],
      },
    ],
  };
}
