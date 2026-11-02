/**
 * The credit gate for the two routes that can spend a vendor pull.
 *
 * Two kinds, two rules:
 *
 * - **niche** — what is already on disk is free to read, for anyone; a fresh
 *   search is paid, and only by a signed-in account.
 * - **handle** — the plan is paid and signed-in always, cache or no cache:
 *   even when the handle's own feed is already on disk, the run still buys
 *   vendor work the visitor could steer anywhere (a fresh search on the phrase
 *   they typed, a profile read, the deep enrich pass). The charge is decided
 *   up front here, then kept or refunded after the run according to what the
 *   vendor ledger says the run really cost — see `settleAfter`.
 *
 * `gate` answers "may this read happen, and what was charged" without spawning
 * anything: the route pulls only after an `ok` verdict, and settles afterwards
 * with `settleAfter`. Nothing here ever talks to a vendor.
 */
import { COSTS } from "./costs";
import { istDay, refund, spend } from "./credits";
import type { SessionUser } from "./auth";

export type GateKind = "niche" | "handle";

export type GateResult =
  | { ok: true; charged: number; entryId?: number }
  | { ok: false; status: 401 | 402; message: string };

/** Whether `key` is already on disk and would be served without a vendor pull. */
export type IsCached = (
  key: string,
  ctx: { nicheHandle?: string }
) => Promise<boolean>;

/** The signed-in user, or null for a visitor who has not signed in. */
export type GetUser = () => Promise<SessionUser | null>;

export interface GateOptions {
  /** The niche phrase, or the handle — whatever this pull is about to read. */
  key?: string;
  /** For a niche read: the optional handle the search would be pinned to. */
  nicheHandle?: string;
  /** For a niche read: a deliberate refresh is never a cache hit. */
  force?: boolean;
  /**
   * Injected in tests; default reads the niche disk cache. Only consulted for
   * niche reads — a handle plan is never cache-free (see the header).
   */
  isCached?: IsCached;
  /** Injected in tests; default reads the db session cookie via next/headers. */
  getUser?: GetUser;
  /** Test clock — the day the pool day and reset message are computed for. */
  now?: Date;
}

/**
 * The disk-backed answer for "is this already on disk", for niche reads.
 *
 * A search is cached when the stored result matched the phrase (and the
 * optional handle it is pinned to) inside its TTL — `nicheCacheStatus().cached`
 * is exactly that verdict. Behind a dynamic import so a plain-node test binary
 * never has to drag the whole pipeline — or Next's request machinery, in auth's
 * case — into its require graph.
 */
async function cachedOnDisk(
  key: string,
  ctx: { nicheHandle?: string }
): Promise<boolean> {
  const { nicheCacheStatus } = await import("./niche");
  return (await nicheCacheStatus(key, ctx.nicheHandle)).cached;
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
 * niche: cached → free, for anyone, charging nothing; not cached and nobody is
 * signed in → 401 (a fresh read has no owner to charge, so it cannot run).
 * handle: never cache-free — the 401/charge path runs whatever the disk holds,
 * because the plan still buys vendor work beyond the handle's own feed.
 * A drained pool → 402 with the reset time, either kind.
 * Never called after a pull — it is the decision that makes the pull possible.
 */
export async function gate(kind: GateKind, opts: GateOptions = {}): Promise<GateResult> {
  const now = opts.now ?? new Date();

  if (kind === "niche" && !opts.force) {
    const cached = await (opts.isCached ?? cachedOnDisk)(opts.key ?? "", {
      nicheHandle: opts.nicheHandle,
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
 * Cancel one specific charge when the work behind it cost the vendor nothing.
 *
 * `entryId` is the ledger row `gate` wrote, undefined when nothing was charged
 * (a cached niche read) — a no-op either way. `vendorCost` is the cost the run
 * actually measured, in whichever unit the caller measured it (units for a
 * niche search, real dollars for a handle plan): non-zero and the charge was
 * right, so the credit stays; zero — the run was free on the vendor side, or
 * the request died — and the whole entry is refunded. Never called with an
 * entryId of 0: `spend(…, 0)` wrote no row, and refunding one would throw.
 */
export async function settle(
  entryId: number | undefined,
  vendorCost: number
): Promise<void> {
  if (entryId === undefined || entryId === 0) return;
  if (vendorCost !== 0) return;
  await refund(entryId);
}

/**
 * Settle, but never let a failed refund overwrite the outcome it is settling.
 *
 * The refund is important — a user must not pay for a run that died — but the
 * request's own verdict is more important: a lost refund is money, an error
 * that replaces the response's real message (or breaks a finished success) is
 * a broken request. So the failure is logged for the operator and swallowed.
 */
async function settleQuietly(entryId: number | undefined, vendorCost: number): Promise<void> {
  try {
    await settle(entryId, vendorCost);
  } catch (err) {
    console.error("[gate] settling the credit refund failed:", (err as Error).message);
  }
}

/**
 * Run the charged work, then settle the charge exactly once per outcome.
 *
 * Everything between the charge and the response lives inside `run`. When it
 * resolves, the charge is settled against the vendor cost the work measured —
 * kept when it is non-zero, refunded when the run cost the vendor nothing.
 * When it throws — a vendor failure, anything after the charge — the charge is
 * refunded in full: no credit is ever kept for a request that produced
 * nothing. The `settled` flag is raised *before* the settle is awaited, so
 * each outcome reaches settle exactly once even if settle itself misbehaves;
 * and since refund is idempotent by its own guard, even a slipped-through
 * second call could only ever write one compensating row.
 */
export async function settleAfter<T>(
  entryId: number | undefined,
  run: () => Promise<T>,
  vendorCost: (result: T) => number
): Promise<T> {
  let settled = false;
  try {
    const value = await run();
    // Raised before the await: the catch-less finally below must never
    // re-settle an outcome that is being settled right now.
    settled = true;
    await settleQuietly(entryId, vendorCost(value));
    return value;
  } finally {
    if (!settled) {
      // The run threw after the charge — full refund, and a refund that
      // itself fails is logged, never raised over the original error.
      settled = true;
      await settleQuietly(entryId, 0);
    }
  }
}
