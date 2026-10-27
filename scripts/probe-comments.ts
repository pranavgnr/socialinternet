import { commentsLanguage, readLanguage } from "../lib/lang";

const cases: Record<string, string[]> = {
  "telugu-latin": ["Relatives nidhra poru emo", "super ga undhi akka", "chala bagundi ra", "ee song keka"],
  english: ["love this cover so much", "your voice is amazing", "what song is this", "obsessed"],
  "hindi-latin": ["kya baat hai bhai", "bahut pyara gaana hai", "mast gana hai yaar", "dil se suna"],
  turkish: ["cok guzel olmus", "harika bir sarki", "sesin cok guzel", "ask bu sarki"],
  mixed: ["so good", "chala bagundi", "love it", "super ra"],
  "hindi-devanagari": ["क्या बात है भाई", "बहुत प्यारा गाना", "मस्त गाना है", "दिल से सुना"],
};

for (const [k, v] of Object.entries(cases)) {
  console.log(
    k,
    "→",
    JSON.stringify(commentsLanguage(v)),
    "| single:",
    JSON.stringify(readLanguage({ caption: v[0] })),
  );
}
