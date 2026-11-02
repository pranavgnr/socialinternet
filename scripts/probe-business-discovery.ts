#!/usr/bin/env node
/**
 * Business Discovery probe — run once by the founder, with a real test token.
 *
 *   npx tsx --env-file=.env.local scripts/probe-business-discovery.ts \
 *     <ig_user_id> <token> <target_username>
 *
 * One Graph API call, asking for exactly the fields that decide the follow-up:
 * `media{id,media_type,view_count,like_count,comments_count,timestamp}`.
 * Instagram's Business Discovery has historically omitted `view_count` for
 * competitor media, which would make it useless for outlier detection. This
 * script answers that one question and prints nothing else.
 *
 * The token is never printed — not in the URL, not in an error. The probe logic
 * is an exported pure function so tests can inject fixture responses without a
 * live token; the CLI only runs when this file is the entry point.
 */

export interface ProbeMedia {
  id?: string;
  media_type?: string;
  view_count?: number | null;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
}

export interface ProbeResult {
  ok: boolean;
  /** true when at least one media row carries a `view_count` key */
  viewCountPresent: boolean;
  /** every numeric `view_count` the API returned */
  viewCounts: number[];
  media: ProbeMedia[];
  error?: string;
}

export interface ProbeInput {
  igUserId: string;
  token: string;
  target: string;
  /** Graph API version, e.g. v21.0 */
  version?: string;
  /** inject fetch in tests */
  fetch?: typeof fetch;
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Remove the token wherever an API error might have quoted the request URL. */
function redact(message: string, token: string): string {
  let out = message;
  if (token.length >= 4) out = out.split(token).join("[redacted]");
  out = out.replace(
    /([?&](?:access_token|token|key|api_key)=)[^&\s]+/gi,
    "$1[redacted]",
  );
  return out.slice(0, 1_000);
}

/**
 * The one URL this probe is allowed to build.
 *
 * `fields` is encoded as a single query value, so the Graph expression's braces
 * and parentheses survive transport unchanged.
 */
export function businessDiscoveryUrl(
  igUserId: string,
  target: string,
  token: string,
  version = process.env.GRAPH_API_VERSION ?? "v21.0",
): string {
  const fields =
    `business_discovery.username(${target})` +
    "{media{id,media_type,view_count,like_count,comments_count,timestamp}}";
  return (
    `https://graph.facebook.com/${version}/${encodeURIComponent(igUserId)}` +
    `?fields=${encodeURIComponent(fields)}` +
    `&access_token=${encodeURIComponent(token)}`
  );
}

function mediaRows(payload: Record<string, unknown>): Record<string, unknown>[] {
  const business = obj(payload.business_discovery);
  const media = business.media ?? payload.media;
  if (Array.isArray(media)) {
    return media.map(obj);
  }
  const data = obj(media).data;
  return Array.isArray(data) ? data.map(obj) : [];
}

/**
 * Make the call and report whether `view_count` exists.
 *
 * One call, always. An API error is returned as `{ ok: false, error }` rather
 * than thrown, so the CLI can print the vendor's own message and exit non-zero.
 */
export async function probeBusinessDiscovery(input: ProbeInput): Promise<ProbeResult> {
  const empty: ProbeResult = {
    ok: false,
    viewCountPresent: false,
    viewCounts: [],
    media: [],
  };

  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(
      businessDiscoveryUrl(input.igUserId, input.target, input.token, input.version),
      { signal: AbortSignal.timeout(30_000) },
    );
  } catch (err) {
    return {
      ...empty,
      error: redact((err as Error).message || "network error", input.token),
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = obj(await response.json());
  } catch {
    /* a non-JSON body is still an error worth reporting below */
  }

  const apiError = obj(payload.error);
  const message = str(apiError.message);
  if (!response.ok || message) {
    return {
      ...empty,
      error: redact(message ?? `HTTP ${response.status}`, input.token),
    };
  }

  const rows = mediaRows(payload);
  const media: ProbeMedia[] = rows.map((row) => ({
    id: str(row.id),
    media_type: str(row.media_type),
    view_count:
      Object.prototype.hasOwnProperty.call(row, "view_count")
        ? num(row.view_count) ?? null
        : undefined,
    like_count: num(row.like_count),
    comments_count: num(row.comments_count),
    timestamp: str(row.timestamp),
  }));

  const viewCountPresent = rows.some((row) =>
    Object.prototype.hasOwnProperty.call(row, "view_count"),
  );
  const viewCounts = media
    .map((row) => row.view_count)
    .filter((value): value is number => typeof value === "number");

  return { ok: true, viewCountPresent, viewCounts, media };
}

export interface MainDeps {
  fetch?: typeof fetch;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

/** Thin CLI. Returns the process exit code instead of calling `process.exit`. */
export async function main(argv: string[], deps: MainDeps = {}): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const [igUserId, token, target] = argv;

  if (!igUserId || !token || !target) {
    error(
      "usage: probe-business-discovery.ts <ig_user_id> <token> <target_username>",
    );
    return 2;
  }

  const result = await probeBusinessDiscovery({
    igUserId,
    token,
    target,
    fetch: deps.fetch,
  });

  if (!result.ok) {
    error(`Business Discovery failed: ${result.error ?? "unknown error"}`);
    return 1;
  }

  log(`Business Discovery @${target}: ${result.media.length} media row(s)`);
  if (result.viewCountPresent) {
    log("view_count: present");
    for (const row of result.media) {
      log(`  ${row.id ?? "(no id)"}: ${row.view_count ?? "null"}`);
    }
  } else {
    log("view_count: absent");
  }
  return 0;
}

/* Only run as a CLI; importing the module in a test must not make a request. */
if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
