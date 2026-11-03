interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Plain answers, including the ones that are not flattering: a fresh read
 * costs gems, rate cards are locked until a verified Instagram connection
 * exists, and no lifestyle date is promised. The accordions are native
 * `<details>` elements so they work without JavaScript and from the keyboard.
 */
const FAQS: FaqItem[] = [
  {
    question: "Can I run an initial audit without registering an account?",
    answer:
      "Cached accounts open free. A fresh read needs a free Google sign-in and uses 6 of your 15 daily gems. The account is read from public posts only; nothing is posted for you.",
  },
  {
    question: "How does Koko calculate verified audience value and rate cards?",
    answer:
      "Rate cards are locked until an Instagram-verified connection exists, so Koko does not quote a verified rate today. It works from public numbers — views, likes, comments and audience signals — and states the sample and confidence behind every estimate.",
  },
  {
    question: "When do Shop, Dine & Stay privileges go live?",
    answer:
      "They are planned for the wave-2 vault. Join the waitlist and we will contact you when access opens; no launch date is promised.",
  },
];

export default function Faq() {
  return (
    <section aria-labelledby="faq-title" className="py-14 sm:py-20">
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <div>
          <p className="mono text-[10px] font-bold uppercase tracking-[0.2em] text-limelight">
            Direct answers
          </p>
          <h2
            id="faq-title"
            className="mt-3 text-[32px] font-semibold leading-[1.02] tracking-[-0.035em] text-pure-white sm:text-[42px]"
          >
            The questions worth asking.
          </h2>
          <p className="mt-3 max-w-sm text-[13.5px] leading-relaxed text-muted-zinc">
            No trial, no lock-in and no invented numbers. If something is still
            behind the velvet rope, this page says so.
          </p>
        </div>

        <div className="divide-y divide-white/10 border-y border-white/10">
          {FAQS.map((item) => (
            <details key={item.question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-5 text-[15px] font-semibold leading-snug text-pure-white marker:content-none [&::-webkit-details-marker]:hidden">
                <span>{item.question}</span>
                <span
                  aria-hidden="true"
                  className="mono mt-0.5 shrink-0 text-[18px] font-normal leading-none text-limelight transition group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl pr-6 text-[13.5px] leading-relaxed text-muted-zinc">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
