import { NextResponse } from "next/server";

import { currentAccount } from "@/lib/session";
import type { Idea } from "@/lib/types";

/** Records what happened to one of this visitor's own ideas. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const account = await currentAccount();
  if (!account) return NextResponse.json({ ok: false }, { status: 404 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<Idea>;

  const patch: Partial<Idea> = {};
  if (body.status === "new" || body.status === "filmed" || body.status === "posted" || body.status === "skipped") {
    patch.status = body.status;
  }
  if (typeof body.viewsAfter7d === "number") patch.viewsAfter7d = body.viewsAfter7d;
  if (body.viewsAfter7d === null) patch.viewsAfter7d = undefined;

  const idea = await account.store.updateIdea(id, patch);
  if (!idea) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true });
}
