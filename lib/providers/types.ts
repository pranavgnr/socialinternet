/**
 * One shape for every data vendor.
 *
 * The pipeline used to speak SocialCrawl's dialect directly, which meant the
 * product's cost, uptime and endpoint coverage were all one vendor's decision.
 * A vendor that raises prices 8x or runs out of credits took the whole site
 * down — which is exactly what happened when the free 100 credits ran out.
 *
 * Everything below is deliberately semantic: "the reels on this account", not
 * "GET /instagram/profile/reels". Each adapter translates its own vendor's
 * response back into the unified row shape that `harvest.normalise()` already
 * reads, so swapping vendors never touches the harvester or the ranking maths.
 */

export type ProviderId =
  | "socialcrawl"
  | "hikerapi"
  | "apify"
  | "youtube"
  /**
   * YouTube's public web pages — the only vendor that needs no key at all.
   * Exists so discovery keeps working when every paid balance reaches zero,
   * which is exactly what took the site down once already.
   */
  | "youtubeweb";

/** What a single call costs, in USD, at list price. */
export interface ProviderCost {
  /**
   * USD per successful call. Kept as a real money number rather than abstract
   * "credits", because credits are vendor play-money with no cross-vendor
   * meaning: 1 SocialCrawl credit and 1 HikerAPI request are both one call, so
   * the honest comparison is dollars.
   */
  usdPerCall: number;
  /** Human label for the pricing line, e.g. "$1.00 / 1,000 calls". */
  label: string;
}

/** A single billable call's result. */
export interface PullResult {
  /**
   * The payload, already translated into SocialCrawl's unified row shape
   * (`{ post: {...} }`) or the legacy flat shape. `harvest.normalise()` reads
   * both, so adapters never leak vendor-specific field names downstream.
   */
  data: Record<string, unknown>;
  /** USD actually charged for this call (0 on a vendor cache hit / free call). */
  usd: number;
  /** vendor units consumed (credits or requests) */
  units: number;
  /** units left on the account, when the vendor reports it */
  remaining: number | null;
  /**
   * Which vendor actually answered.
   *
   * Set by the router, not the adapter, because only the router knows. The
   * harvester needs it: rows from YouTube describe YouTube accounts, and
   * stamping them "instagram" would corrupt the platform on every reel the
   * free provider serves.
   */
  provider?: ProviderId;
}

export interface ProviderBalance {
  /** units left, or null when the vendor will not say */
  remaining: number | null;
  /** the vendor's own word for the unit: "credits", "requests" */
  unit: string;
  /** USD spent since process start, tracked locally */
  usdSpent: number;
  ok: boolean;
  error?: string;
}

/**
 * What a keyword search may ask the vendor to add.
 *
 * `relevance` exists because the vendor judges every search row against the
 * query anyway — free, on by default — but only *eventually*: a page sent while
 * the judge is still working carries `computed.relevance: null` on the rows it
 * has not reached (30 rows, 18 judged, 12 pending is a normal first page).
 * Asking for `score` makes the call wait until every row is judged, which is
 * the difference between a subject gate with a second reader on 60% of a pull
 * and one with it on all of it. Vendors that do not judge rows ignore this.
 */
export interface SearchOptions {
  /** `score` waits for every row; `filter` also drops rows that are not on topic */
  relevance?: "score" | "filter";
  /** only with `filter`: the probability a row must reach. The vendor's default is 0.5 */
  relevanceThreshold?: number;
}

/** The logical operations the pipeline needs. Four calls cover ~99% of spend. */
export interface DataProvider {
  id: ProviderId;
  /** what the vendor calls itself, for the UI */
  name: string;
  cost: ProviderCost;
  /** false when no key is configured — the router skips unconfigured vendors */
  configured(): boolean;
  /** a page of an account's recent reels — the benchmark pull */
  profileReels(handle: string): Promise<PullResult>;
  /** reels matching a keyword — the cheap way to discover accounts */
  searchReels(query: string, opts?: SearchOptions): Promise<PullResult>;
  /** one post in full (caption, metrics, comments, MP4 link) */
  post(url: string): Promise<PullResult>;
  /** follower count, bio, category — one call per handle */
  profile(handle: string): Promise<PullResult>;
  /** free on both vendors: never costs a unit */
  balance(): Promise<ProviderBalance>;
  /**
   * How early this vendor should be tried for a given logical call. Lower wins.
   *
   * Needed because "cheapest" is not the same as "right". YouTube is free and
   * can answer a keyword search perfectly well, so it should go first there —
   * but it is a poor first try for an Instagram handle it has never heard of,
   * and trying it anyway costs a wasted quota call and a second of latency on
   * every benchmark pull. Defaults to 0 (try in cost order).
   */
  preference?(path: string): number;
}

/** An error that means "this vendor cannot serve the call — try the next one". */
export class ProviderUnavailable extends Error {
  constructor(
    readonly provider: ProviderId,
    message: string,
    /** true when the account is empty, so retrying the same vendor is pointless */
    readonly exhausted = false,
  ) {
    super(message);
    this.name = "ProviderUnavailable";
  }
}
