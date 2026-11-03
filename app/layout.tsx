import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Plus_Jakarta_Sans, Space_Mono } from "next/font/google";

import KokoConcierge from "@/components/KokoConcierge";
import InstallPrompt from "@/components/InstallPrompt";
import PwaRegister from "@/components/PwaRegister";
import LegacyNav from "@/components/LegacyNav";
import SiteHeader, {
  HeaderControls,
  HeaderControlsFallback,
} from "@/components/SiteHeader";
import { getViewer } from "@/lib/viewer";

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
  applicationName: "Shambles",
  title: "Shambles — the AI that works for creators",
  description:
    "Shambles reads a public Instagram account, shows what is actually working in its niche, and tells the creator what to post next. Koko, the AI director, does the work.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Shambles",
    statusBarStyle: "black-translucent",
  },
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
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The whole header chrome — account controls and the temporary legacy nav —
 * comes from one viewer read. They share a Suspense boundary so the shell never
 * asks for the session twice; the fallback is the same header with a neutral
 * account skeleton.
 */
async function HeaderChrome() {
  const { user, credits, hasPlan } = await getViewer();
  return (
    <>
      <SiteHeader
        controls={<HeaderControls user={user} credits={credits} />}
      />
      <LegacyNav hasPlan={hasPlan} />
    </>
  );
}

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
        <Suspense fallback={<SiteHeader controls={<HeaderControlsFallback />} />}>
          <HeaderChrome />
        </Suspense>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-5">
          {children}
        </main>

        <footer className="mx-auto w-full max-w-6xl px-5 pb-24 pt-4 sm:pb-10">
          <p className="text-[11px] leading-relaxed text-muted/60">
            Shambles reads public posts only. Nothing is posted for you. Not
            affiliated with Instagram.
          </p>
        </footer>

        <KokoConcierge />
        <InstallPrompt />
        <PwaRegister />
      </body>
    </html>
  );
}
