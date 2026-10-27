import { songFromCaption, songOf } from "../lib/songs";

const cases = [
  "The ending is hilaaaarious 🤣🤣🤣\nHow many of you remember this song?😎",
  "Dream to reality✨\nNanna modala cinema haadu “Bandhana Noda Chendulla Cheluva”😍",
  "Ello Jogappa | Performed by @the_staccato_cafe_live \n\nLet us know in the comment section",
  "Kabhi Kabhi Aditi✨💗💃🏻\n\n@arrahman @geneliad @imrankhan",
  "Agh this song🫠\n@alluarjunonline",
];
for (const c of cases) {
  console.log(JSON.stringify(songFromCaption(c) ?? null), "  <=  ", JSON.stringify(c.split("\n")[0].slice(0,70)));
}
