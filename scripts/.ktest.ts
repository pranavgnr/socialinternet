import { songOf, songFromCaption } from "../lib/songs";
const cases = [
  "ಜಾನಪದ ❤️‍🔥 ",
  "Janappada 💥",
  "ನಮ್ಮೂರ ಹಬ್ಬ 2.0 💥 ",
  "Blooperrrrr🙇🏻‍♀️🙇🏻‍♀️",
  "8 years back💎✨",
  "Celebration At vrudhshrama 🙏#manjukukanoorsinger🤍 #viral #singing ",
];
for (const c of cases) console.log(JSON.stringify(songFromCaption(c) ?? null), " <=", JSON.stringify(c.slice(0,50)));
