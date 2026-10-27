import { availableProviders } from "../lib/providers";
const paths = ["/instagram/profile/reels", "/instagram/search/reels", "/youtube/channel", undefined];
for (const p of paths) {
  console.log((p ?? "(none)").padEnd(28), "->", availableProviders(p).map(x => `${x.id}($${x.cost.usdPerCall})`).join(", ") || "NONE");
}
