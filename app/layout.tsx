import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Space_Mono } from "next/font/google";

import KokoConcierge from "@/components/KokoConcierge";
import SiteHeader from "@/components/SiteHeader";

import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Shambles — the AI that works for creators",
  description:
    "Shambles reads a public Instagram account, shows what is actually working in its niche, and tells the creator what to post next. Koko, the AI director, does the work.",
  openGraph: {
    title: "Shambles — the AI that works for creators",
    description:
      "An AI director for Instagram creators: a real account audit, competitor intel and the next posts worth making.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#09090C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${spaceMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg text-text">
        <SiteHeader />

        <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-5">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-2xl px-5 pb-10 pt-4">
          <p className="text-[11px] leading-relaxed text-muted/60">
            Shambles reads public posts only. Nothing is posted for you. Not
            affiliated with Instagram.
          </p>
        </footer>

        <KokoConcierge />
      </body>
    </html>
  );
}
