/**
 * Vendor canary: one cheap, fixed read per vendor, every day.
 *
 * The product's whole ranking rests on two fields: views and followers. A vendor
 * that quietly stops returning either does not fail loudly — it returns rows
 * that parse, score zero, and produce a confident plan built on nothing. That is
 * the failure this file exists to catch.
 *
 * The sample is deliberately normalised through `harvest.normaliseProviderRows`
 * rather than read from the vendor's raw JSON: the canary must judge exactly what
 * the pipeline would see, not whichever field spelling a vendor chose this week.
 * Rows are therefore `RawReel`s (`views`, `followers`), never raw payloads.
 */
import { currentDb } from "./db";
import { redactSecrets } from "./env";
import { normaliseProviderRows } from "./harvest";
import { allProviders, creditLedger, recordDirectSpend } from "./providers";
import type { DataProvider, ProviderId } from "./providers/types";

export interface CanaryCheck {
  ok: boolean;
  detail: string;
}

export interface CanaryResult extends CanaryCheck {
  vendor: ProviderId;
}

export interface CanarySkipped {
  vendor: ProviderId;
  reason: string;
}

export interface CanaryRun {
  /** vendors actually read and recorded in `vendor_canary` */
  results: CanaryResult[];
  /** vendors not read at all — no row, no webhook failure */
  skipped: CanarySkipped[];
}

/**
 * Which adapters are expected to return a follower count on normalised rows.
 *
 * Confirmed from the adapters, not guessed:
 *   - `hikerapi` reads the profile first and passes its `follower_count` into
 *     every media row as an author hint;
 *   - `scrapecreators` maps `owner.follower_count`/`owner.followers` onto
 *     `post.author.followers` in `reelRow()`;
 *   - `socialcrawl` returns the vendor's own unified `post.author.followers`
 *     through unchanged, which is the field `harvest.fromUnified()` reads.
 *
 * `apify`'s posts payload has an empty `owner` (live-verified), so a missing
 * follower count there is a known shape, not an outage. Unknown ids default to
 * "does not promise followers" below: absence is only a failure when the
 * adapter says it should be present.
 */
export const EXPECTS_FOLLOWERS: Readonly<Record<ProviderId, boolean>> = {
  hikerapi: true,
  scrapecreators: true,
  socialcrawl: true,
  apify: false,
  youtube: false,
  youtubeweb: false,
};

/** YouTube vendors are discovery readers, not Instagram measurement vendors. */
function isYoutube(provider: DataProvider): boolean {
  return provider.id === "youtube" || provider.id === "youtubeweb";
}

/** The one public handle every vendor is asked for. */
export function canaryHandle(): string {
  const configured = process.env.CANARY_HANDLE?.trim().replace(/^@/, "");
  return configured || "natgeo";
}

/**
 * The sample's health, by three plain rules:
 *
 *   1. no rows at all is a failure — the vendor answered with nothing;
 *   2. fewer than half the rows carrying `views > 0` is a failure — the ranking
 *      cannot price a room from a page of zeros;
 *   3. `followers` absent on every row is a failure **only for vendors whose
 *      adapter promises a follower count** (`EXPECTS_FOLLOWERS`). For the rest,
 *      absence is noted in the detail and is not a failure.
 *
 * The detail names the rule that broke, because "failed" alone sends the
 * operator looking at the wrong thing.
 */
export function checkCanary(
  vendor: ProviderId,
  sample: Record<string, unknown>[],
): CanaryCheck {
  if (!sample.length) {
    return { ok: false, detail: "no rows returned" };
  }

  const withViews = sample.filter((row) => {
    const views = row.views;
    return typeof views === "number" && Number.isFinite(views) && views > 0;
  }).length;
  const viewShare = withViews / sample.length;

  if (viewShare < 0.5) {
    return {
      ok: false,
      detail: `only ${withViews} of ${sample.length} rows have views (need at least 50%)`,
    };
  }

  const withFollowers = sample.filter((row) => {
    const followers = row.followers;
    return (
      typeof followers === "number" && Number.isFinite(followers) && followers > 0
    );
  }).length;

  const base = `${sample.length} rows, ${withViews} with views`;

  if (!withFollowers) {
    if (EXPECTS_FOLLOWERS[vendor] ?? false) {
      return {
        ok: false,
        detail: `followers missing on every row (${sample.length} rows)`,
      };
    }
    return {
      ok: true,
      detail: `${base}; followers not provided by this vendor`,
    };
  }

  return { ok: true, detail: `${base}, ${withFollowers} with followers` };
}

/** Env vars whose values must never reach a canary row or a webhook body. */
/**
 * Re-exported from `lib/env.ts`, where the router can also use it without an
 * import cycle through the canary. Existing callers keep working unchanged.
 */
export { redactSecrets } from "./env";

/** Per-run real-money ceiling, defaulting to 25 cents. */
function maxUsd(): number {
  const raw = process.env.CANARY_MAX_USD;
  if (!raw) return 0.25;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.25;
}

/**
 * Why a vendor must not be called, or `null` when it looks usable.
 *
 * Unconfigured vendors are skipped without a balance call. Only an explicit
 * "nothing left" skips a configured one. A balance endpoint that errors is
 * treated as unknown, exactly as the router does: refusing to test a vendor
 * because it was shy about its balance would hide the outage the canary exists
 * to find.
 */
async function skipReason(provider: DataProvider): Promise<string | null> {
  if (!provider.configured()) return "not configured";

  try {
    const balance = await provider.balance();
    if (typeof balance.remaining === "number" && balance.remaining < 1) {
      return `vendor reports 0 ${balance.unit} left`;
    }
  } catch {
    /* unknown is not evidence of an empty account */
  }
  return null;
}

async function record(result: CanaryResult): Promise<void> {
  await currentDb().query(
    "INSERT INTO vendor_canary (vendor, ok, detail, checked_at) VALUES ($1, $2, $3, now())",
    [result.vendor, result.ok, result.detail],
  );
}

/**
 * Post failures to the operator's webhook, if one is configured.
 *
 * Deliberately best-effort: the canary's job is to observe vendors, not to be a
 * second thing that can page someone at 3am because a webhook host is down.
 * Skipped vendors are not failures and never appear here.
 */
async function notifyFailures(
  results: CanaryResult[],
  opts: CanaryOptions,
): Promise<void> {
  const failures = results.filter((r) => !r.ok);
  if (!failures.length) return;

  const configured = "webhookUrl" in opts ? opts.webhookUrl : process.env.CANARY_WEBHOOK_URL;
  if (!configured) return;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const body = JSON.stringify({
    text: `Data vendor canary failed: ${failures.map((f) => f.vendor).join(", ")}`,
    failures: failures.map(({ vendor, detail }) => ({ vendor, detail })),
  });

  try {
    await (opts.fetch ?? fetch)(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* the notification is best-effort; a failed POST must not fail the canary */
  }
}

export interface CanaryOptions {
  /** test only this vendor id */
  vendor?: string;
  /** inject fake vendors in tests; defaults to every known Instagram vendor */
  providers?: DataProvider[];
  /** override `CANARY_HANDLE` */
  handle?: string;
  /** inject fetch in tests */
  fetch?: typeof fetch;
  /** override `CANARY_WEBHOOK_URL`; `null` disables it */
  webhookUrl?: string | null;
}

/**
 * Read one public handle through every configured Instagram vendor.
 *
 * Each vendor is called directly, one profile read, bypassing the router's
 * failover: the point is to learn which vendors work, not which one the router
 * would prefer today. A vendor failure becomes a failed row with a redacted
 * message; it never aborts the other vendors or throws out of this function.
 *
 * Unconfigured or unaffordable vendors are *skipped*: no row, no webhook, and
 * no spend. They are returned separately so the route can say why they were not
 * tested without turning a normal "no key" into a pager alert.
 */
export async function runCanary(opts: CanaryOptions = {}): Promise<CanaryRun> {
  const handle = (opts.handle?.trim() || canaryHandle()).replace(/^@/, "") || "natgeo";
  const source = (opts.providers ?? allProviders()).filter(
    (provider) => !isYoutube(provider),
  );
  const chosen = opts.vendor
    ? source.filter((provider) => provider.id === opts.vendor)
    : source;

  const results: CanaryResult[] = [];
  const skipped: CanarySkipped[] = [];
  const ceiling = maxUsd();
  /** Real money spent by this run, read as a ledger delta around each read. */
  let spentThisRun = 0;

  for (const provider of chosen) {
    const reason = await skipReason(provider);
    if (reason) {
      skipped.push({ vendor: provider.id, reason });
      continue;
    }

    /**
     * The next read is only allowed if its expected price still fits under the
     * ceiling. `effectiveUsdPerCall` can be zero inside a free allowance, which
     * is exactly right: a free read cannot cross a real-money ceiling.
     */
    const estimate =
      provider.cost.effectiveUsdPerCall?.() ?? provider.cost.usdPerCall;
    if (spentThisRun + estimate > ceiling) {
      skipped.push({ vendor: provider.id, reason: "canary spend ceiling" });
      continue;
    }

    try {
      const before = creditLedger().usd;
      const pulled = await provider.profileReels(handle);
      /**
       * Direct adapter calls bypass the router, so the shared ledger has to be
       * told about the spend. Reading the delta back from it is what makes the
       * ceiling see money actually spent, not an estimate.
       */
      recordDirectSpend(provider.id, pulled);
      spentThisRun += creditLedger().usd - before;

      const rows = normaliseProviderRows(pulled.data, "instagram", handle);
      /**
       * `RawReel` is an interface, which TypeScript will not widen to an index
       * signature for free; the rows are still exactly what the canary is meant
       * to inspect.
       */
      const check = checkCanary(
        provider.id,
        rows as unknown as Record<string, unknown>[],
      );
      results.push({ vendor: provider.id, ...check });
    } catch (err) {
      results.push({
        vendor: provider.id,
        ok: false,
        detail: redactSecrets((err as Error).message || "vendor call failed"),
      });
    }
  }

  for (const result of results) await record(result);
  await notifyFailures(results, opts);

  return { results, skipped };
}
