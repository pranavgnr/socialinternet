import type { GrowthPlan } from "./types";

/**
 * The competitor view of a plan.
 *
 * `analyseHandle` builds one plan shape for everyone: it diagnoses the account,
 * decides the next move, and writes the ideas behind it. That is right for the
 * creator who owns the handle and wrong for someone reading a public account —
 * advice is not transferable, and the evidence is.
 *
 * So the measured half stays (standing, the best and worst posts with their
 * explanations, the comment themes, the archetype label, the cohort) and every
 * field that speaks to the account's owner is removed: the next move, the move
 * list, the diagnosis, the songs/formats/hooks advice and the hook reading.
 * `moves`, `gaps`, `questions`, `diagnosis` are cleared rather than deleted so
 * the returned value still satisfies `GrowthPlan` and a page can render it
 * without defensive checks.
 */
export function toCompetitorView(plan: GrowthPlan): GrowthPlan {
  return {
    ...plan,
    diagnosis: "",
    gaps: [],
    moves: [],
    questions: [],
    nextMove: undefined,
    songs: undefined,
    formats: undefined,
    hooks: undefined,
    hookRead: undefined,
  };
}
