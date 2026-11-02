import { currentUser } from "@/lib/auth";
import { loadHistory, runChat, saveTurn } from "@/lib/chat";
import { balance, refund, spend } from "@/lib/credits";
import { llmReady, jsonCall } from "@/lib/llm";
import { currentAccount } from "@/lib/session";

export const maxDuration = 120;

/**
 * POST /api/chat  { message }
 *
 * The handler is deliberately thin: the ordered, refundable flow lives in
 * `runChat` so it can be tested without Next's request machinery. The account
 * store is read here — through the signed-in user's own account — and every
 * side effect is the production implementation.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { message?: unknown };

  return runChat(body.message, {
    getUser: () => currentUser(),
    ready: llmReady,
    loadPlan: async () => {
      const account = await currentAccount();
      return account ? account.store.getPlan() : null;
    },
    balance,
    spend: (userId, amount, reason) => spend(userId, amount, reason),
    refund,
    history: loadHistory,
    save: saveTurn,
    call: jsonCall,
  });
}
