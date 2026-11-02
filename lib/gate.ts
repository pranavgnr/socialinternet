/**
 * The credit gate for the two routes that can spend a vendor pull.
 *
 * One rule decides everything: what is already on disk is free to read; a
 * fresh pull is paid. Free here means two different things — a read served
 * from cache costs nobody anything (anonymous visitors get it), while a fresh
 * pull is only for signed-in accounts, who pay out of their daily free pool.
 *
 * `gate` answers "may this read happen, and what was charged" without spawning
 * anything: the route pulls only after an `ok` verdict, and settles afterwards
 * with `settleAfter`. Nothing here ever talks to a vendor.
 */
import { COSTS } from "./costs";
import { istDay, refund, spend } from "./credits";
import type { Platform } from "./types";
import type { SessionUser } from "./auth";

export type GateKind = "niche" | "handle";

export type GateResult =
  | { ok: true; charged: number; entryId?: number }
  | { ok: false; status: 401 | 402; message: string };

/** Whether `key` is already on disk and would be served without a vendor pull. */
export type IsCached = (
  kind: GateKind,
  key: string,
  ctx: { nicheHandle?: string; platform?: Platform }
) => Promise<boolean>;

/** The signed-in user, or null for a visitor who has not signed in. */
export type GetUser = () => Promise<SessionUser | null>;

export interface GateOptions {
  /** The niche phrase, or the handle — whatever this pull is about to read. */
  key?: string;
  /** For a niche read: the optional handle the search would be pinned to. */
  nicheHandle?: string;
  /** For a handle read: the network it would be read from. */
  platform?: Platform;
  /** A deliberate refresh is never a cache hit, whoever is asking. */
  force?: boolean;
  /** Injected in tests; default reads the disk caches (niche + handle). */
  isCached?: IsCached;
  /** Injected in tests; default reads the db session cookie via next/headers. */
  getUser?: GetUser;
  /** Test clock — the day the pool day and reset message are computed for. */
  now?: Date;
}

/**
 * The disk-backed answer for "is this already on disk".
 *
 * Niche reads are cached when the stored search matched the phrase (and the
 * optional handle it is pinned to) inside its TTL — `nicheCacheStatus().cached`
 * is exactly that verdict. Handle reads go through `handleIsCached`, whose test
 * mirrors what `pullOwn` serves from disk. Kept behind dynamic imports so a
 * plain-node test binary never has to drag the whole pipeline — or Next's
 * request machinery, in auth's case — into its require graph.
 */
async function cachedOnDisk(
  kind: GateKind,
  key: string,
  ctx: { nicheHandle?: string; platform?: Platform }
): Promise<boolean> {
  if (kind === "niche") {
    const { nicheCacheStatus } = await import("./niche");
    return (await nicheCacheStatus(key, ctx.nicheHandle)).cached;
  }
  const { handleIsCached } = await import("./plan");
  return handleIsCached(key, ctx.platform ?? "instagram");
}

/** What each kind is called in the messages a visitor actually reads. */
const LABEL: Record<GateKind, string> = {
  niche: "niche search",
  handle: "handle plan",
};

const HOUR = 60 * 60 * 1000;

/**
 * The next IST midnight. The free pool is granted per IST day and never
 * accumulates, so it refills then, whether or not it was drained today.
 */
function nextIstMidnight(now: Date): Date {
  // IST is UTC+05:30 all year (no DST): naming the offset is enough to land on
  // the exact minute, and a YYYY-MM-DD prefix builds a full instant from it.
  const todayMidnight = new Date(`${istDay(now)}T00:00:00+05:30`);
  return new Date(todayMidnight.getTime() + 24 * HOUR);
}

/**
 * The 402 a drained pool earns. Says the price, the balance left, and when the
 * pool comes back — both "tomorrow at 12:00 am IST" and the rough wait, because
 * a visitor deciding whether to wait deserves both formats.
 */
function outOfCredits(kind: GateKind, cost: number, balance: number, now: Date): string {
  const msToReset = nextIstMidnight(now).getTime() - now.getTime();
  const hours = Math.max(1, Math.ceil(msToReset / HOUR));
  return (
    `A fresh ${LABEL[kind]} costs ${cost} credits and you have ${balance} left today. ` +
    `Your free pool resets tomorrow at 12:00 am IST — about ${hours} hour${hours === 1 ? "" : "s"} from now.`
  );
}

/**
 * Decide whether a read may happen, and charge for it when it must be paid.
 *
 * Cached → free, for anyone, charging nothing. Not cached and nobody is
 * signed in → 401 (a fresh read has no owner to charge, so it cannot run).
 * Signed in but the day's pool will not cover it → 402 with the reset time.
 * Never called after a pull — it is the decision that makes the pull possible.
 */
export async function gate(kind: GateKind, opts: GateOptions = {}): Promise<GateResult> {
  const now = opts.now ?? new Date();

  if (!opts.force) {
    const cached = await (opts.isCached ?? cachedOnDisk)(kind, opts.key ?? "", {
      nicheHandle: opts.nicheHandle,
      platform: opts.platform,
    });
    if (cached) return { ok: true, charged: 0 };
  }

  const getUser = opts.getUser ?? (async () => (await import("./auth")).currentUser());
  const user = await getUser();
  if (!user) {
    return { ok: false, status: 401, message: "Sign in to read a new one" };
  }

  const cost = kind === "niche" ? COSTS.niche : COSTS.handle;
  // A price overridden to 0 by env spends nothing and `spend` would hand back
  // entryId 0 with no ledger row — indistinguishable from a cached read, so
  // normalise it before it can flow into settle()/refund().
  if (cost === 0) return { ok: true, charged: 0 };
  const res = await spend(user.id, cost, kind, opts.key, now);
  if (!res.ok) {
    return { ok: false, status: 402, message: outOfCredits(kind, cost, res.balance, now) };
  }
  // A zero-amount spend writes no ledger row and returns entryId 0; the gate
  // only charges real costs, so a real entry id always rides along here.
  return { ok: true, charged: cost, entryId: res.entryId };
}

/**
 * Cancel one specific charge when the work behind it came at no cost.
 *
 * `entryId` is the ledger row `gate` wrote, undefined when nothing was charged
 * (a cached read) — a no-op either way. A non-zero vendor spend means the
 * charge was right, so the credit stays; zero (the pull was free on the vendor
 * side, or the request died) refunds the whole entry. Never called with an
 * entryId of 0: `spend(…, 0)` wrote no row, and refunding one would throw.
 */
export async function settle(
  entryId: number | undefined,
  actuallySpentVendorCredits: number
): Promise<void> {
  if (entryId === undefined || entryId === 0) return;
  if (actuallySpentVendorCredits !== 0) return;
  await refund(entryId);
}

/**
 * Run the charged work, then settle the charge exactly once.
 *
 * Everything between the charge and the response lives inside `run`. When it
 * resolves, the charge is settled against the vendor credits the work really
 * spent — kept when they are non-zero, refunded when the pull was free. When
 * it throws — a vendor failure, anything after the charge — the charge is
 * refunded in full: no credit is ever kept for a request that produced
 * nothing. The `settled` flag keeps the two paths from double-refunding, which
 * `refund` would survive but which must not be relied on here.
 */
export async function settleAfter<T>(
  entryId: number | undefined,
  run: () => Promise<T>,
  vendorSpent: (result: T) => number
): Promise<T> {
  let settled = false;
  try {
    const value = await run();
    await settle(entryId, vendorSpent(value));
    settled = true;
    return value;
  } finally {
    if (!settled) await settle(entryId, 0);
  }
}
