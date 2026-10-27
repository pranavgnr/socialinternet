import Link from "next/link";
import type { GrowthPlan } from "@/lib/types";
import { fmtViews, plain, sentenceCase, times, titleCase } from "@/lib/plain";
import { platformName, postUrl, profileUrl } from "@/lib/platform";

const LABEL = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted";

/** Captions and transcripts are evidence, not reading material: show the opening. */
function beginning(text: string | undefined, max = 90): string {
  const clean = plain(text ?? "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}…`;
}

/** Plain words for what the opening actually is. */
function hookModeLabel(mode: string): string {
  switch (mode) {
    case "spoken":
      return "Your hook is something said out loud";
    case "on_screen":
      return "Your hook is written on the screen";
    case "visual":
      return "Your hook is the picture itself";
    case "both":
      return "Your hook is words and picture together";
    default:
      return "Your hook is not one thing yet";
  }
}

function tone(pct: number): string {
  if (pct >= 60) return "You are ahead of most of them. The job now is making it repeat.";
  if (pct >= 35) return "You are in the pack. One change moves you out of it.";
  return "Most accounts your size are doing better right now. The plan below is about closing that.";
}

export default function PlanView({ plan }: { plan: GrowthPlan }) {
  /**
   * A plan with no shape cannot be rendered honestly, but it must not take the
   * page down either — a stored plan from an older build is a real possibility.
   */
  const arch =
    plan.archetype ?? {
      id: "general",
      label: "Creator",
      blurb: "We could not tell what kind of account this is yet.",
      songLed: false,
      recommendation: "none" as const,
    };

  const pct = Math.round(plan.standing.percentile * 100);
  const usual = plan.standing.medianViews;
  const best = plan.standing.bestViews;
  const spread = usual > 0 ? best / usual : 0;
  const typical = plan.gaps.find(
    (g) => /usual|reel|post/.test(g.label) && !/best|day/i.test(g.label),
  );
  const peerTypical = typical?.cohort;
  const accounts = plan.cohort.accounts;
  // Plans stored before the family existed have no field; fall back rather than
  // crash a returning visitor's page.
  const family =
    arch.recommendation ?? (arch.songLed ? "songs" : "hooks");

  const shape = [
    titleCase(arch.label),
    arch.language ? titleCase(arch.language) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const songs = arch.songLed ? plan.songs ?? [] : [];
  const formats = plan.formats ?? [];
  const hooks = plan.hooks ?? [];

  return (
    <div className="space-y-6">
      <section>
        <a
          href={profileUrl(plan.handle, plan.platform)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[34px] items-center text-[23px] font-semibold leading-tight tracking-tight transition hover:text-accent"
        >
          @{plan.handle}
        </a>
        <p className="mt-1 text-[12.5px] text-muted">
          {shape}
          {plan.standing.followers ? ` · ${fmtViews(plan.standing.followers)} followers` : ""}
          {plan.platform ? ` · read from ${platformName(plan.platform)}` : ""}
        </p>

        <div className="mt-4 grid grid-cols-3 divide-x divide-line/70 rounded-xl border border-line bg-panel">
          <div className="px-3 py-3">
            <div className="text-[19px] font-medium leading-none tabular-nums">
              {fmtViews(usual)}
            </div>
            <div className="mt-1.5 text-[11px] leading-tight text-muted">your usual post</div>
          </div>
          <div className="px-3 py-3">
            <div className="text-[19px] font-medium leading-none tabular-nums">
              {fmtViews(best)}
            </div>
            <div className="mt-1.5 text-[11px] leading-tight text-muted">your best</div>
          </div>
          <div className="px-3 py-3">
            <div className="text-[19px] font-medium leading-none tabular-nums">{pct}%</div>
            <div className="mt-1.5 text-[11px] leading-tight text-muted">
              of accounts you beat
            </div>
          </div>
        </div>
      </section>

      <section className="card px-4 py-4">
        <p className="text-[14.5px] leading-relaxed">{plain(arch.blurb)}</p>
        <p className="mt-2.5 border-t border-line/60 pt-2.5 text-[13px] leading-relaxed text-muted">
          You usually get around {fmtViews(usual)} views a post
          {peerTypical ? `, against ${peerTypical} for accounts your size` : ""}. {tone(pct)}
        </p>
        {spread >= 3 ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Your best did {times(spread)} your usual, so the ceiling is clearly there — it just
            has not happened twice.
          </p>
        ) : null}
        <p className="mt-3 border-t border-line/60 pt-2.5 text-[11.5px] leading-relaxed text-muted/70">
          Built from {plan.standing.reelsRead} of your posts and {accounts} accounts your size in
          the same space.
          {plan.nicheFit && !plan.nicheFit.ok
            ? plan.nicheFit.verdict === "wrong"
              ? ` That group may be the wrong room — we searched “${plan.nicheFit.searched}” — so treat the numbers as provisional.`
              : ` Accounts that were plainly in another space were left out of the numbers.`
            : ""}
        </p>
      </section>

      {/* The one move. Ten ideas compete with each other; one does not. */}
      {plan.nextMove ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">This week, do one thing</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Chosen because of what your own posts show — not what works for someone else.
            </p>
          </div>
          <article className="card overflow-hidden border-accent/30">
            <div className="px-4 py-3.5">
              <h3 className="text-[15.5px] font-semibold leading-snug">
                {plain(plan.nextMove.title)}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                {plain(plan.nextMove.why)}
              </p>
            </div>
            <div className="border-t border-line/70 px-4 py-3">
              <p className={`${LABEL} mb-1 text-accent`}>Do this</p>
              <p className="text-[13.5px] leading-relaxed">{plain(plan.nextMove.action)}</p>
              {plan.nextMove.stop ? (
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  <span className="text-muted/70">Stop: </span>
                  {plain(plan.nextMove.stop)}
                </p>
              ) : null}
            </div>
            <div className="border-t border-line/70 bg-panel2/40 px-4 py-2.5">
              <p className="text-[11.5px] leading-relaxed text-muted/70">
                {plan.nextMove.checkOn}
              </p>
              <p className="mt-1 text-[11px] text-muted/50">
                Based on {plan.nextMove.basis} · {Math.round(plan.nextMove.confidence * 100)}%
                confident
              </p>
            </div>
          </article>
        </section>
      ) : null}

      {/* Where the hook lives: a sentence, a caption, or the picture. */}
      {plan.hookRead && plan.hookRead.sampled > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Where your hook lives</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              “Make a better hook” is not advice. This says whether the first second that held
              people was something said, something written, or something happening.
            </p>
          </div>
          <div className="card px-4 py-4">
            <p className="text-[15px] font-medium">{hookModeLabel(plan.hookRead.mode)}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              {plain(plan.hookRead.sentence)}
            </p>
            <p className="mt-2 text-[11.5px] text-muted/60">
              {Math.round(plan.hookRead.share * 100)}% of the {plan.hookRead.sampled} posts we
              watched · read from {plan.hookRead.basis === "measured" ? "the video itself" : "the caption"}
            </p>
            {plan.hookRead.examples.length ? (
              <div className="mt-3 space-y-1.5 border-t border-line/60 pt-2.5">
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted/60">
                  the openings that worked
                </p>
                {plan.hookRead.examples.map((e, i) => (
                  <a
                    key={`${e.url}-${i}`}
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[12px] leading-snug transition hover:text-text"
                  >
                    <span className="text-muted">“{beginning(e.text)}”</span>{" "}
                    <span className="text-muted/50">{times(e.views)}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* The account read against itself: winners vs losers. */}
      {plan.audit && plan.audit.gaps.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Your own posts, compared</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Your best and worst post, side by side. This is the only evidence that is about you
              and not about someone bigger.
            </p>
          </div>
          <div className="card divide-y divide-line/70">
            <div className="grid grid-cols-2 divide-x divide-line/70">
              <a
                href={plan.audit.best.url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-3 transition hover:text-text"
              >
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted/60">worked</p>
                <p className="mt-1 text-[15px] font-medium tabular-nums">
                  {times(plan.audit.best.multiple)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted/70">
                  {beginning(plan.audit.best.caption) || "no caption"}
                </p>
              </a>
              <div className="px-3 py-3">
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted/60">did not</p>
                <p className="mt-1 text-[15px] font-medium tabular-nums">
                  {times(plan.audit.worst.multiple)}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted/70">
                  {beginning(plan.audit.worst.caption) || "no caption"}
                </p>
              </div>
            </div>
            {plan.audit.gaps.slice(0, 3).map((g, i) => (
              <div key={`${g.lever}-${i}`} className="px-4 py-3">
                <p className="text-[13px] leading-relaxed">
                  <span className="text-muted/60">{g.lever}: </span>
                  {plain(g.note)}
                </p>
              </div>
            ))}
            <div className="px-4 py-2.5 text-[11.5px] leading-relaxed text-muted/60">
              {plan.audit.posts} of your posts read
              {plan.audit.watched ? `, ${plan.audit.watched} watched` : ""}
              {plan.audit.cadence.medianGapDays
                ? ` · you post about every ${Math.round(plan.audit.cadence.medianGapDays)} days`
                : ""}
              {plan.audit.breadth
                ? ` · ${plan.audit.breadth} different format${plan.audit.breadth === 1 ? "" : "s"} tried`
                : ""}
            </div>
          </div>
        </section>
      ) : null}

      {/* What the audience asked for, in their own words. */}
      {plan.comments && plan.comments.seeds.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">What people asked for</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              Read from the comments under the posts that worked. These are requests, not guesses.
            </p>
          </div>
          <div className="card divide-y divide-line/70">
            {plan.comments.seeds.slice(0, 5).map((c, i) => (
              <div key={`${c.text}-${i}`} className="px-4 py-3">
                <p className="text-[13px] leading-relaxed">{beginning(c.text, 140)}</p>
                <p className="mt-1 text-[11px] text-muted/60">
                  {c.kind === "request"
                    ? "asked for"
                    : c.kind === "question"
                      ? "asked"
                      : c.kind === "objection"
                        ? "pushed back on"
                        : "told a story about"}
                  {c.asked > 1 ? ` · ${c.asked} times` : ""}
                  {c.ideas[0] ? ` · make: ${beginning(c.ideas[0], 70)}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Who the platform says they are — only for a creator already in the field. */}
      {plan.account?.bio || plan.account?.category ? (
        <section className="card px-4 py-4">
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted/60">
            How your account reads
          </p>
          {plan.account.category ? (
            <p className="mt-1.5 text-[13px] leading-relaxed">
              Filed under <span className="font-medium">{plan.account.category}</span>
              {plan.account.verified ? " · verified" : ""}
            </p>
          ) : null}
          {plan.account.bio ? (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              “{beginning(plan.account.bio, 180)}”
            </p>
          ) : null}
        </section>
      ) : null}

      {songs.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Songs worth covering</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              These broke out for accounts your size — not for accounts ten times bigger. On a
              cover the song does most of the work, so it is the cheapest thing to copy exactly.
            </p>
          </div>

          <div className="card divide-y divide-line/60">
            {songs.map((s) => (
              <div key={s.title} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[14.5px] font-medium leading-snug">
                    {s.title}
                    {s.fromYou ? (
                      <span className="ml-2 rounded border border-accent/40 px-1 py-0.5 align-middle text-[9.5px] uppercase tracking-wider text-accent">
                        you
                      </span>
                    ) : null}
                  </p>
                  <span className="shrink-0 text-[12px] tabular-nums text-accent">
                    {times(s.multiple)} usual
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{s.why}</p>
                <div className="mt-1.5 space-y-0.5">
                  {s.evidence.slice(0, 2).map((e, i) => (
                    <a
                      key={`${e.url ?? e.handle}-${i}`}
                      href={postUrl(e.url, e.handle, plan.platform)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[11.5px] leading-snug text-muted/70 transition hover:text-text"
                    >
                      <span className="text-accent/80">{e.handle}</span> {plain(e.metric)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {formats.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">
              {family === "craft"
                ? "What is landing for accounts your size"
                : "Video shapes worth making more of"}
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              {family === "craft"
                ? "The shapes that broke out for accounts your size. The finished result does most of the work in all of them."
                : "The shapes of video that broke out for accounts your size. Copy the shape; the subject stays yours."}
            </p>
          </div>

          <div className="card divide-y divide-line/60">
            {formats.map((f) => (
              <div key={f.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[14.5px] font-medium leading-snug">
                    {plain(f.label)}
                  </p>
                  <span className="shrink-0 text-[12px] tabular-nums text-accent">
                    {times(f.multiple)} usual
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  {sentenceCase(plain(f.what))}.
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted/70">
                  {f.posts} {f.posts === 1 ? "post" : "posts"} ·{" "}
                  {f.accounts} accounts your size
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {f.evidence.slice(0, 2).map((e, i) => (
                    <a
                      key={`${e.url ?? e.handle}-${i}`}
                      href={postUrl(e.url, e.handle, plan.platform)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[11.5px] leading-snug text-muted/70 transition hover:text-text"
                    >
                      <span className="text-accent/80">{e.handle}</span>{" "}
                      {plain(e.metric)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {hooks.length ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">How these open</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              For what you make, the first line is the decision — the topic is already yours.
              This is how the posts breaking out around your size start, and what was said.
            </p>
          </div>

          <div className="card divide-y divide-line/60">
            {hooks.map((h) => (
              <div key={h.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[14.5px] font-medium leading-snug">
                    Open with {h.label}
                  </p>
                  <span className="shrink-0 text-[12px] tabular-nums text-accent">
                    {times(h.multiple)} usual
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{h.what}</p>
                {h.example ? (
                  <p className="mt-2 border-l border-line pl-2.5 text-[12.5px] italic leading-snug text-muted/80">
                    &ldquo;{plain(h.example)}&rdquo;
                  </p>
                ) : null}
                <p className="mt-1 text-[11.5px] leading-relaxed text-muted/70">
                  {h.posts} {h.posts === 1 ? "post" : "posts"} · {h.accounts} accounts your size
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {h.evidence.slice(0, 2).map((e, i) => (
                    <a
                      key={`${e.url ?? e.handle}-${i}`}
                      href={postUrl(e.url, e.handle, plan.platform)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[11.5px] leading-snug text-muted/70 transition hover:text-text"
                    >
                      <span className="text-accent/80">{e.handle}</span> {plain(e.metric)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight">Do these next, in order</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            One at a time. Each one opens the post that proves it.
          </p>
        </div>

        {plan.moves.length ? (
          plan.moves.map((m) => (
            <article key={m.id} className="card overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-accent/40 text-[11px] text-accent">
                  {m.priority}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold leading-snug">{plain(m.title)}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{plain(m.why)}</p>
                </div>
              </div>

              <div className="border-t border-line/70 px-4 py-3">
                <p className={`${LABEL} mb-1 text-accent`}>Do this</p>
                <p className="text-[13.5px] leading-relaxed">{plain(m.action)}</p>
              </div>

              {m.evidence.length ? (
                <div className="space-y-1.5 border-t border-line/70 bg-panel2/40 px-4 py-2.5">
                  <p className="text-[10.5px] uppercase tracking-[0.14em] text-muted/60">
                    the post behind it
                  </p>
                  {m.evidence.map((e, i) => (
                    <a
                      key={`${e.url ?? e.handle + i}`}
                      href={postUrl(e.url, e.handle, plan.platform)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-[12px] leading-snug transition hover:text-text"
                    >
                      <span className="text-accent">{e.handle}</span>{" "}
                      <span className="text-muted">{plain(e.metric)}</span>
                      {e.caption ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted/60">
                          {e.caption}
                        </span>
                      ) : null}
                    </a>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p className="card px-4 py-6 text-center text-[13px] leading-relaxed text-muted">
            Nothing in your space was convincing enough to recommend yet. Check back in a week.
          </p>
        )}
      </section>

      <Link
        href="/ideas"
        className="block rounded-xl bg-accent px-4 py-3.5 text-center text-[14px] font-semibold text-black transition active:scale-[0.995]"
      >
        {songs.length
          ? "This week’s covers →"
          : formats.length
            ? "This week’s videos →"
            : "This week’s posts →"}
      </Link>

      <p className="pb-1 text-center text-[11px] leading-relaxed text-muted/60">
        Updated{" "}
        {new Date(plan.generatedAt).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        })}
        . Open any post to check it yourself.
      </p>
    </div>
  );
}
