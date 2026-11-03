"use client";

import { useRef, useState } from "react";

import type { WaitlistFeature } from "@/lib/waitlist";
import LockedCard from "./LockedCard";
import WaitlistForm from "./WaitlistForm";

interface VaultFeature {
  feature: WaitlistFeature;
  title: string;
  blurb: string;
  label: string;
}

const FEATURES: VaultFeature[] = [
  {
    feature: "shop-dine-stay",
    title: "SHOP, DINE, STAY",
    blurb:
      "Pay via UPI at boutique hotels and luxury cafés, post verified content, and receive up to 100% cashback. Planned for wave 2.",
    label: "Shop, Dine & Stay",
  },
  {
    feature: "mini-business",
    title: "1-CLICK MINI-BUSINESS",
    blurb:
      "Launch a creator storefront, take bookings and get paid without building a second business. Planned for wave 2.",
    label: "1-Click Mini-Business",
  },
  {
    feature: "rate-card",
    title: "VERIFIED RATE CARD ESCROW",
    blurb:
      "A verified rate card, held in escrow for brand work. Locked until an Instagram-verified connection exists.",
    label: "Verified Rate Card Escrow",
  },
  {
    feature: "comment-to-dm",
    title: "UNLIMITED FREE COMMENT-TO-DM",
    blurb:
      "Turn viewer requests in your comments into automatic DMs, without paying for another tool. Planned for wave 2.",
    label: "Unlimited Free Comment-to-DM",
  },
];

const DEFAULT_LABEL = "VIP waitlist";

/**
 * The vault is one list, not four forms. Clicking a locked card selects the
 * feature and moves the visitor to the shared request form; the card stays
 * visibly selected so it is clear what the request is for. The default is the
 * general VIP waitlist, which is what the header's JOIN VIP link promises.
 */
export default function Vault() {
  const [feature, setFeature] = useState<WaitlistFeature>("vip");
  const requestRef = useRef<HTMLDivElement>(null);
  const selected = FEATURES.find((item) => item.feature === feature);

  function choose(next: WaitlistFeature) {
    setFeature(next);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
    // Move keyboard and screen-reader users straight to the request they just
    // chose, without letting focus cancel the smooth scroll.
    requestRef.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
  }

  return (
    <section
      id="vault"
      aria-labelledby="vault-title"
      className="scroll-mt-24 border-y border-white/10 py-14 sm:py-20"
    >
      <div className="max-w-3xl">
        <p className="mono text-[11px] font-bold uppercase tracking-[0.2em] text-luxury-gold">
          WAVE-2 PRIORITY ACCESS: EXCLUSIVE INVITATION ONLY
        </p>
        <h2
          id="vault-title"
          className="mt-3 text-[32px] font-semibold leading-[1.02] tracking-[-0.035em] text-pure-white sm:text-[48px]"
        >
          THE VELVET-ROPE WAITLIST VAULT
        </h2>
        <p className="mt-4 text-[16px] leading-relaxed text-muted-zinc">
          The privileges below are planned, not shipped. One request reserves
          your place for the feature you want first. No marketing sends in
          launch.
        </p>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {FEATURES.map((item) => (
          <LockedCard
            key={item.feature}
            feature={item.feature}
            title={item.title}
            blurb={item.blurb}
            source="landing-vault"
            selected={feature === item.feature}
            ctaLabel="Request this"
            onSelect={() => choose(item.feature)}
          />
        ))}
      </div>

      <div
        ref={requestRef}
        id="vault-request"
        className="card mt-4 scroll-mt-24 p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <p className="mono text-[11px] font-bold uppercase tracking-[0.18em] text-luxury-gold">
            Request access
          </p>
          <p className="text-[11.5px] text-muted-zinc">
            Requesting:{" "}
            <span className="font-semibold text-pure-white">
              {selected?.label ?? DEFAULT_LABEL}
            </span>
          </p>
        </div>

        <p className="mt-2 text-[15px] leading-relaxed text-muted-zinc">
          {selected
            ? `Tell us where to reach you when ${selected.label} opens.`
            : "Tell us where to reach you when the wave-2 vault opens."}
        </p>

        <WaitlistForm
          feature={feature}
          source="landing-vault"
          className="mt-4"
          submitLabel="REQUEST ->"
          contactPlaceholder="Your Corporate Email or WhatsApp..."
          handlePlaceholder="@your_handle"
        />
      </div>
    </section>
  );
}
