import type { SessionUser } from "./auth";
import { gate, settleAfter, type IsCached } from "./gate";
import type { RoomPlan } from "./newcomer";
import type { NicheResearch } from "./niche";
import { creditLedger } from "./providers";
import type { Store } from "./store";
import type { Profile } from "./types";

/**
 * `POST /api/room` without Next.
 *
 * A room is a niche pull, so it follows the same rule as `/api/niche`: a room
 * already on disk is free to anyone, while a fresh pull needs a signed-in
 * account and costs `COSTS.niche` up front. The gate decides that before
 * `researchNiche` is ever called; the charge is then settled against the real
 * vendor ledger — refunded when the pull threw or measured zero spend.
 *
 * Extracted from the route so the money rules can be tested with plain Node:
 * the vendor call, the store and the post-response scheduler are injected, and
 * nothing in this file imports `next/server`.
 */
export interface RoomRequestInput {
  query: string;
  force?: boolean;
}

export interface RoomRequestDeps {
  store: Pick<Store, "getProfile" | "saveRoom" | "saveProfile">;
  /** null for a visitor who has not signed in */
  user: SessionUser | null;
  researchNiche: (opts: { query: string; force?: boolean }) => Promise<NicheResearch>;
  buildRoomPlan: (research: NicheResearch) => RoomPlan;
  roomProfile: (research: NicheResearch, previous: Profile | null) => Profile;
  runPipeline: (args: {
    profile: Profile;
    seedReels: NicheResearch["payload"];
    seedCredits: NicheResearch["credits"];
    db: Store;
  }) => Promise<unknown>;
  /** schedules work after the response — `after()` in the route, a spy in tests */
  scheduleAfter: (fn: () => Promise<void>) => void;
  logError: (err: unknown) => void;
  /** injected in tests; defaults to the disk cache through the gate */
  isCached?: IsCached;
  now?: Date;
}

export type RoomOutcome =
  | { status: 200; room: RoomPlan; free: boolean }
  | { status: 401 | 402; error: string };

export async function runRoomRequest(
  input: RoomRequestInput,
  deps: RoomRequestDeps,
): Promise<RoomOutcome> {
  const verdict = await gate("niche", {
    key: input.query,
    force: input.force,
    getUser: async () => deps.user,
    isCached: deps.isCached,
    now: deps.now,
  });
  if (verdict.ok === false) {
    return { status: verdict.status, error: verdict.message };
  }

  /**
   * Snapshot the monotonic counter, not `usd`: a fresh niche pull elsewhere in
   * the process resets `usd`, and a reset landing between this line and the
   * settle would make a paid pull look free.
   */
  const usdAtStart = creditLedger().lifetimeUsd;

  const outcome = await settleAfter(
    verdict.entryId,
    async () => {
      const research = await deps.researchNiche({
        query: input.query,
        force: input.force,
      });

      const room = deps.buildRoomPlan(research);
      const profile = deps.roomProfile(research, await deps.store.getProfile());

      await deps.store.saveRoom(room);
      await deps.store.saveProfile(profile);

      /**
       * The idea feed is written after the response, exactly as on the handle
       * path: the plan is the answer the visitor is waiting for. It is rebuilt
       * from the reels this search already paid for, so it adds no cost.
       */
      deps.scheduleAfter(async () => {
        try {
          await deps.runPipeline({
            profile,
            seedReels: research.payload,
            seedCredits: research.credits,
            db: deps.store as Store,
          });
        } catch (err) {
          deps.logError(err);
        }
      });

      return {
        room,
        free: creditLedger().lifetimeUsd - usdAtStart === 0,
      };
    },
    () => creditLedger().lifetimeUsd - usdAtStart,
  );

  return { status: 200, room: outcome.room, free: outcome.free };
}
