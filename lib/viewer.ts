import { cache } from "react";

import { currentUser, type SessionUser } from "./auth";
import { balance } from "./credits";
import { accountForCookie, accountForUser } from "./session";

export interface Viewer {
  user: SessionUser | null;
  credits: number | null;
  hasPlan: boolean;
}

/**
 * Everything the shell needs to know about the visitor, read once per render.
 *
 * The header controls and the temporary legacy nav come from this one call
 * (see app/layout.tsx). React's `cache()` also collapses any second caller in
 * the same render. The memo ends with the render; nothing is shared across
 * requests or across Next's HTML/flight renders.
 */
export const getViewer = cache(async function getViewer(): Promise<Viewer> {
  const user = await currentUser().catch(() => null);

  if (!user) {
    const account = await accountForCookie().catch(() => null);
    const plan = account
      ? await account.store.getPlan().catch(() => null)
      : null;
    return { user: null, credits: null, hasPlan: Boolean(plan) };
  }

  const account = accountForUser(user);
  const [credits, plan] = await Promise.all([
    balance(user.id).catch(() => null),
    account ? account.store.getPlan().catch(() => null) : Promise.resolve(null),
  ]);

  return { user, credits, hasPlan: Boolean(plan) };
});
