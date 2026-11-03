import type { Metadata } from "next";
import { connection } from "next/server";

import KokoStudio, { type ScriptPrompt } from "@/components/koko/KokoStudio";
import { normalizeHandle } from "@/lib/handle";
import { nicheCacheStatus } from "@/lib/niche";
import { enrichProfilePlan } from "@/lib/profileData";
import { buildProfileView, type ProfileView } from "@/lib/profileView";
import { readProfileView } from "@/lib/profileStore";
import { currentAccount } from "@/lib/session";
import type { GrowthPlan } from "@/lib/types";
import { getViewer } from "@/lib/viewer";

export const instant = false;

export const metadata: Metadata = {
  title: "Koko — Shambles AI director",
  description:
    "Koko works from the account and niche that were actually read: scripts, competitor patterns and the next post.",
  robots: { index: false, follow: false },
};

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function introFor({
  handle,
  niche,
  nicheLoaded,
  nicheIsPrimary,
  competitors,
  hasComments,
  hasProfile,
  signedIn,
}: {
  handle: string | null;
  niche: string | null;
  nicheLoaded: boolean;
  nicheIsPrimary: boolean;
  competitors: number;
  hasComments: boolean;
  hasProfile: boolean;
  signedIn: boolean;
}): string {
  if (nicheIsPrimary && niche && nicheLoaded) {
    const account = handle && hasProfile ? ` and @${handle}'s profile` : "";
    const crew =
      competitors > 0
        ? `, plus ${competitors} ${competitors === 1 ? "competitor" : "competitors"}`
        : "";
    return `I've got the cached data for ${niche} loaded${account}${crew}. Ask me for shot-by-shot Reel scripts, what is breaking out in that space, or what to post next.`;
  }

  if (handle && hasProfile) {
    const commentLine = hasComments
      ? "profile and the comments we read"
      : "stored profile";
    const crew =
      competitors > 0
        ? ` and ${competitors} ${competitors === 1 ? "competitor" : "competitors"}`
        : "";
    return `I've got @${handle}'s ${commentLine} loaded${crew}. Ask me for shot-by-shot Reel scripts, competitor patterns, or what to post next.`;
  }

  if (niche && nicheLoaded) {
    return `I've got the cached data for ${niche} loaded. Ask me for shot-by-shot Reel scripts, what is breaking out in that space, or what to post next.`;
  }

  if (niche && !nicheLoaded) {
    return "I do not have that niche loaded yet. Open it from search first.";
  }

  if (!signedIn) {
    return "Sign in and I can work from the account or niche that was read.";
  }

  return "I do not have an account or a niche loaded yet. Analyse a handle or open a niche search, then come back.";
}

/**
 * `/chat` — Koko's studio.
 *
 * Everything here is a read: the viewer's own saved plan, a stored profile view
 * for a handle it opened with, and the on-disk niche dossier. No vendor call and
 * no charge happen on load. A script link (`?action=script&idea=1&handle=x`)
 * becomes a confirmation card in the client, never an automatic send.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{
    handle?: string | string[];
    niche?: string | string[];
    action?: string | string[];
    idea?: string | string[];
  }>;
}) {
  await connection();

  const params = await searchParams;
  const rawHandle = first(params.handle);
  const rawNiche = first(params.niche);
  const rawAction = first(params.action);
  const rawIdea = first(params.idea);

  const handle = rawHandle ? normalizeHandle(rawHandle) : null;
  const nicheParam = rawNiche
    ? rawNiche.replace(/\s+/g, " ").trim().slice(0, 120) || null
    : null;
  const idea =
    rawIdea && /^\d{1,2}$/.test(rawIdea.trim()) ? Number(rawIdea.trim()) : null;

  let signedIn = false;
  let credits: number | null = null;
  let plan: GrowthPlan | null = null;

  try {
    const viewer = await getViewer();
    signedIn = Boolean(viewer.user);
    credits = viewer.credits;

    if (viewer.user) {
      const account = await currentAccount();
      plan = account ? await account.store.getPlan() : null;
    }
  } catch (err) {
    // A database outage must not take the studio down: the visitor gets the
    // calm sign-in state instead of a 500.
    console.error("[chat] viewer read failed:", (err as Error).message);
  }

  const ownHandle = plan?.handle ? normalizeHandle(plan.handle) : null;
  const memoryHandle = handle ?? ownHandle;
  const isOwn = Boolean(ownHandle && memoryHandle === ownHandle);

  let storedView: ProfileView | null = null;
  if (memoryHandle && !isOwn) {
    const stored = await readProfileView(memoryHandle).catch((err) => {
      console.error("[chat] stored profile read failed:", (err as Error).message);
      return null;
    });
    storedView = stored?.view ?? null;
  }

  const ownView =
    isOwn && plan ? buildProfileView(enrichProfilePlan(plan), { own: true }) : null;
  const contextView = isOwn ? ownView : storedView;

  const planNiche = plan?.niche?.trim() || null;
  const niche = nicheParam ?? planNiche;

  let nicheLoaded = Boolean(planNiche || contextView?.niche);
  if (nicheParam) {
    const sameAsPlan =
      Boolean(planNiche) &&
      planNiche!.toLowerCase() === nicheParam.toLowerCase();
    const sameAsProfile =
      Boolean(contextView?.niche) &&
      contextView!.niche.toLowerCase() === nicheParam.toLowerCase();
    if (sameAsPlan || sameAsProfile) {
      nicheLoaded = true;
    } else {
      const status = await nicheCacheStatus(nicheParam).catch(() => null);
      nicheLoaded = Boolean(status?.cached);
    }
  }

  const competitors = isOwn
    ? (plan?.competitors ?? []).filter(
        (competitor) =>
          competitor.platform === "instagram" &&
          Boolean(normalizeHandle(competitor.handle)),
      ).length
    : (contextView?.ideas.length ?? 0);

  const competitorHandle = isOwn
    ? (plan?.competitors ?? [])
        .map((competitor) =>
          competitor.platform === "instagram"
            ? normalizeHandle(competitor.handle)
            : null,
        )
        .find((value): value is string => Boolean(value)) ?? null
    : (contextView?.ideas[0]?.fromHandle
        ? normalizeHandle(contextView.ideas[0].fromHandle)
        : null);

  const script: ScriptPrompt | null =
    rawAction === "script" && handle && idea
      ? {
          idea,
          handle,
          label: `Script idea ${idea}`,
          concept: contextView?.ideas[idea - 1]?.concept ?? "",
        }
      : null;

  const backHref = handle
    ? `/profile/${encodeURIComponent(handle)}`
    : nicheParam
      ? `/search/niche/${encodeURIComponent(nicheParam)}`
      : "/";

  const intro = introFor({
    handle: memoryHandle,
    niche,
    nicheLoaded,
    nicheIsPrimary: Boolean(nicheParam),
    competitors,
    hasComments: Boolean(plan?.comments?.read),
    hasProfile: Boolean(isOwn ? plan : storedView),
    signedIn,
  });

  return (
    <KokoStudio
      backHref={backHref}
      signedIn={signedIn}
      handle={memoryHandle}
      niche={niche}
      nicheLoaded={nicheLoaded}
      competitors={competitors}
      credits={credits}
      intro={intro}
      deepSpyHandle={competitorHandle}
      script={script}
    />
  );
}
