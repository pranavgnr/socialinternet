/**
 * One source of truth for what is live on the landing page.
 *
 * A pillar may only say "Live now" when the feature is actually shipped. Until
 * then it says "Coming soon" (the work is in the launch plan) or "Planned ·
 * wave 2" (it is behind the waitlist). The status is read by the UI, never
 * retyped in a component, so a badge cannot drift ahead of the product.
 */
export type FeatureStatus = "live" | "soon" | "planned";

export type PillarKey = "audit" | "competitor-intel" | "lifestyle-vip";

export const FEATURE_STATUS: Record<PillarKey, FeatureStatus> = {
  // TODO(task-7-followup): the sample is dormant until follower paging is
  // verified; the slab says "Estimate coming" rather than showing a number.
  audit: "soon",

  // Live from Task 4: /profile/[handle] shows the competitor profile view.
  "competitor-intel": "live",

  // TODO(wave-2): stays planned through the launch plan; no task flips it.
  "lifestyle-vip": "planned",
};

const LABELS: Record<FeatureStatus, string> = {
  live: "Live now",
  soon: "Coming soon",
  planned: "Planned · wave 2",
};

export function statusLabel(status: FeatureStatus): string {
  return LABELS[status];
}
