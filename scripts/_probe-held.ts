import { accountProfile, commentsLanguage, inLanguage, readLanguage } from "../lib/lang";
const TELUGU = ["super ga undhi akka", "chala bagundi ra", "ee song keka", "nidhra poru emo"];
const r: any = {
  id: "CC1", platform: "instagram", account: "cover_acct",
  url: "https://www.instagram.com/reel/CC1/", caption: "love this one 💛",
  postedAt: "2026-09-01T00:00:00Z", views: 10000, likes: 1, comments: 10,
  topComments: TELUGU.map((text) => ({ text, likes: 0 })),
};
console.log("read:", readLanguage(r));
console.log("said:", commentsLanguage(r.comments, r.topComments));
const p = accountProfile([r], "en");
console.log("profile:", p);
console.log("verdict:", inLanguage(r, "en", p.mixed ? null : p));
