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
import { normaliseProviderRows } from "./harvest";
import { configuredProviders } from "./providers";
import type { DataProvider, ProviderId } from "./providers/types";

export interface CanaryCheck {
  ok: boolean;
  detail: string;
}

export interface CanaryResult extends CanaryCheck {
  vendor: ProviderId;
}

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
 *   3. `followers` absent on every row is a failure — headroom needs to know
 *      whether the account breaking out is small.
 *
 * The detail names the rule that broke, because "failed" alone sends the
 * operator looking at the wrong thing.
 */
export function checkCanary(
  _vendor: ProviderId,
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

  if (!withFollowers) {
    return {
      ok: false,
      detail: `followers missing on every row (${sample.length} rows)`,
    };
  }

  return {
    ok: true,
    detail: `${sample.length} rows, ${withViews} with views, ${withFollowers} with followers`,
  };
}

/** Env vars whose values must never reach a canary row or a webhook body. */
const SECRET_ENV = [
  "APIFY_TOKEN",
  "SOCIALCRAWL_API_KEY",
  "SCRAPECREATORS_API_KEY",
  "HIKERAPI_KEY",
  "CRON_SECRET",
];

/**
 * A vendor error can quote the request URL, and those URLs carry tokens. Keep
 * the message, remove the credential: a canary row is stored and may be posted
 * to an operator webhook.
 */
export function redactSecrets(message: string): string {
  let out = message;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  out = out.replace(
    /([?&](?:token|key|api_key|apikey|access_token)=)[^&\s]+/gi,
    "$1[redacted]",
  );
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  return out.slice(0, 500);
}

/**
 * Why a vendor must not be called, or `null` when it looks usable.
 *
 * Only an explicit "nothing left" skips the read. A balance endpoint that errors
 * is treated as unknown, exactly as the router does: refusing to test a vendor
 * because it was shy about its balance would hide the outage the canary exists
 * to find. `configured()` has already filtered key-less vendors.
 */
async function skipReason(provider: DataProvider): Promise<string | null> {
  try {
    const balance = await provider.balance();
    if (typeof balance.remaining === "number" && balance.remaining < 1) {
      return `skipped: vendor reports 0 ${balance.unit} left`;
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
  /** inject fake vendors in tests; defaults to every configured Instagram vendor */
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
 */
export async function runCanary(opts: CanaryOptions = {}): Promise<CanaryResult[]> {
  const handle = (opts.handle?.trim() || canaryHandle()).replace(/^@/, "") || "natgeo";
  const source = (opts.providers ?? configuredProviders()).filter(
    (provider) => !isYoutube(provider),
  );
  const chosen = opts.vendor
    ? source.filter((provider) => provider.id === opts.vendor)
    : source;

  const results: CanaryResult[] = [];

  for (const provider of chosen) {
    const skipped = await skipReason(provider);
    if (skipped) {
      results.push({ vendor: provider.id, ok: false, detail: skipped });
      continue;
    }

    try {
      const pulled = await provider.profileReels(handle);
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

  return results;
}
