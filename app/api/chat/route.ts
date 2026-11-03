import { currentUser } from "@/lib/auth";
import { loadHistory, runChat, saveTurn } from "@/lib/chat";
import { balance, refund, spend } from "@/lib/credits";
import { llmReady, jsonCall } from "@/lib/llm";
import { cachedNicheResearch } from "@/lib/niche";
import { readProfileView } from "@/lib/profileStore";
import { currentAccount } from "@/lib/session";

export const maxDuration = 120;

/**
 * POST /api/chat  { message?, action?, handle?, niche?, idea? }
 *
 * The handler is deliberately thin: the ordered, refundable flow lives in
 * `runChat` so it can be tested without Next's request machinery. The account
 * store and the two disk readers are wired here — a stored profile view for a
 * script link, and the cached niche dossier for a niche conversation. Neither
 * talks to a vendor.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  return runChat(body, {
    getUser: () => currentUser(),
    ready: llmReady,
    loadPlan: async () => {
      const account = await currentAccount();
      return account ? account.store.getPlan() : null;
    },
    loadProfile: async (handle) => {
      const stored = await readProfileView(handle);
      return stored?.view ?? null;
    },
    loadNiche: (niche) => cachedNicheResearch(niche),
    balance,
    spend: (userId, amount, reason) => spend(userId, amount, reason),
    refund,
    history: loadHistory,
    save: saveTurn,
    call: jsonCall,
  });
}
