import { cache } from "react";

import { currentUser, type SessionUser } from "./auth";
import { balance } from "./credits";

export interface Viewer {
  user: SessionUser | null;
  credits: number | null;
}

/**
 * Everything the shell needs to know about the visitor, read once per render.
 *
 * The header controls come from this one call (see app/layout.tsx). React's
 * `cache()` also collapses any second caller in the same render. The memo ends
 * with the render; nothing is shared across requests or across Next's
 * HTML/flight renders.
 *
 * The shell does not need the saved plan any more: the old plan-holder
 * dashboard and its legacy nav are gone, and `/` decides on its own whether to
 * send a plan holder to their profile.
 */
export const getViewer = cache(async function getViewer(): Promise<Viewer> {
  const user = await currentUser().catch(() => null);
  if (!user) return { user: null, credits: null };

  const credits = await balance(user.id).catch(() => null);
  return { user, credits };
});
