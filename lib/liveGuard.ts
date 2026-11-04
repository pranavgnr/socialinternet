/**
 * Argument parsing and the real-money call cap for the live verification script.
 *
 * These live here rather than inside `scripts/verify-instagram-live.ts` so the
 * guard can be unit-tested with an injected fetch and exit. The guard is the
 * only thing standing between a test run and the rest of the wallet, and an
 * untested money guard is not a guard.
 */

export interface Args {
  handle?: string;
  niche?: string;
  warm?: string;
  cap: number;
  force: boolean;
  /** render the plan from the handle/niche cache instead of re-buying it */
  cached: boolean;
  peers: boolean;
}

/** A bad command line. The script turns this into usage text and exit 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * Parse the verification command line.
 *
 * Defaults to a 40-call cap. A cap of zero, a negative cap, a non-numeric cap,
 * `--warm` without a value and a missing handle all throw `UsageError`; the
 * script must never interpret a malformed guard as "no cap".
 */
export function parseArgs(argv: string[]): Args {
  const args: Args = { cap: 40, force: false, cached: false, peers: true };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cap") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 1) {
        throw new UsageError(`--cap needs a positive number, got ${raw ?? "(none)"}`);
      }
      args.cap = Math.floor(n);
    } else if (a === "--warm") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        throw new UsageError("--warm needs a niche phrase");
      }
      args.warm = value;
    } else if (a === "--force") {
      args.force = true;
    } else if (a === "--cached") {
      args.cached = true;
    } else if (a === "--no-peers") {
      args.peers = false;
    } else if (a.startsWith("--")) {
      throw new UsageError(`unknown option ${a}`);
    } else {
      rest.push(a);
    }
  }
  if (!args.warm) {
    args.handle = rest[0];
    args.niche = rest[1];
    if (!args.handle || !args.niche) {
      throw new UsageError("a handle and a niche phrase are required");
    }
  }
  return args;
}

const HIKERAPI = "https://api.hikerapi.com";
const APIFY = "https://api.apify.com";

export interface Tally {
  calls: number;
  byEndpoint: Map<string, number>;
  byVendor: Map<string, number>;
}

/**
 * Which billable vendor endpoint a URL is.
 *
 * Balance checks are free and are not part of the call budget, so they are
 * excluded. Everything else on the two vendor hosts is counted, including a
 * retry: a 5xx may not be billable, but counting it is the conservative answer.
 */
export function vendorEndpoint(
  url: string,
): { vendor: string; endpoint: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin === HIKERAPI) {
    if (parsed.pathname.startsWith("/sys/")) return null;
    return { vendor: "hikerapi", endpoint: parsed.pathname };
  }
  if (parsed.origin === APIFY) {
    return { vendor: "apify", endpoint: parsed.pathname };
  }
  return null;
}

export interface GuardOptions {
  cap: number;
  /** The fetch the guard wraps. Defaults to the process's current fetch. */
  fetchImpl?: typeof fetch;
  /** Called instead of process.exit on a cap hit, so tests can observe it. */
  exit?: (code: number) => void;
  /** Where the abort message goes. Tests inject a no-op. */
  log?: (line: string) => void;
}

export interface GuardHandle {
  tally: Tally;
  /** Restore the fetch that was active before `installGuard`. */
  restore: () => void;
}

/**
 * Wrap the process fetch with a hard cap.
 *
 * The guard aborts by exiting, not by throwing: plenty of the data layer's
 * catch blocks deliberately swallow a vendor failure and carry on with fewer
 * rows. Letting the cap exception be swallowed would make the script look like
 * it finished while it had actually stopped spending. The aborted request is
 * never handed to the underlying fetch.
 */
export function installGuard(opts: GuardOptions): GuardHandle {
  const cap = opts.cap;
  const underlying = opts.fetchImpl ?? globalThis.fetch;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log = opts.log ?? ((line: string) => console.error(line));
  const previous = globalThis.fetch;
  const tally: Tally = {
    calls: 0,
    byEndpoint: new Map(),
    byVendor: new Map(),
  };

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const hit = vendorEndpoint(url);
    if (hit) {
      if (tally.calls >= cap) {
        log(`\nSTOP: live call cap reached before ${hit.vendor} ${hit.endpoint}.`);
        log(
          `calls used: ${tally.calls} (cap ${cap}). No further vendor request was sent.`,
        );
        log(`by vendor: ${JSON.stringify(Object.fromEntries(tally.byVendor))}`);
        log(`by endpoint: ${JSON.stringify(Object.fromEntries(tally.byEndpoint))}`);
        exit(3);
        /**
         * The injected exit in tests may return. Do not fall through to the
         * network: the whole point is that the refused request is never sent.
         */
        throw new Error("live call cap reached");
      }
      tally.calls += 1;
      tally.byEndpoint.set(
        hit.endpoint,
        (tally.byEndpoint.get(hit.endpoint) ?? 0) + 1,
      );
      tally.byVendor.set(hit.vendor, (tally.byVendor.get(hit.vendor) ?? 0) + 1);
    }
    return underlying(input, init);
  }) as typeof fetch;

  return {
    tally,
    restore: () => {
      globalThis.fetch = previous;
    },
  };
}
