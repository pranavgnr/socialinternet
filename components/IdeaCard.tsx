"use client";

import { useState } from "react";
import type { FormatContainer, Idea, Recommendation } from "@/lib/types";
import { lowerFirst, phaseWarn, plain, times } from "@/lib/plain";

const STATUS_WORD: Record<string, string> = {
  filmed: "made",
  posted: "posted",
};

const FORMAT_WORD: Record<FormatContainer, string> = {
  performance: "Cover",
  tutorial: "Tutorial",
  challenge: "Challenge",
  before_after: "Before and after",
  listicle: "List",
  story: "Story",
  pov: "POV",
  comparison: "Comparison",
  reaction: "Reaction",
  case_study: "Case study",
};

const LABEL =
  "text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          setDone(false);
        }
      }}
      className="inline-flex min-h-[32px] items-center rounded-md border border-line px-2.5 text-[11.5px] text-muted transition hover:text-text"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

export default function IdeaCard({
  idea,
  family = "hooks",
}: {
  idea: Idea;
  /**
   * What kind of opening this account gets. The field is called hookVariants in
   * storage for compatibility, but a vlogger's first second is a moment, not a
   * line — so the label has to match what is actually inside it.
   */
  family?: Recommendation;
}) {
  const songLed = family === "songs";
  const openingLabel = songLed
    ? "First words on screen"
    : family === "formats"
      ? "How it opens"
      : family === "craft"
        ? "What is on screen first"
        : "Your first line";
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState(idea.status);
  const [views, setViews] = useState<string>(
    idea.viewsAfter7d ? String(idea.viewsAfter7d) : "",
  );
  const [saved, setSaved] = useState(false);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/idea/${idea.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok && typeof body.status === "string") {
      setStatus(body.status as Idea["status"]);
    }
  }

  async function saveViews() {
    await patch({
      viewsAfter7d: views ? Number(views) : null,
      ...(views ? { status: "posted" } : {}),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <article className="card overflow-hidden">
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-[15.5px] font-semibold leading-snug">
            {plain(idea.title)}
          </h2>
          {STATUS_WORD[status] ? (
            <span className="shrink-0 rounded-md border border-accent/40 px-1.5 py-0.5 text-[10.5px] text-accent">
              {STATUS_WORD[status]}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
          <span>{FORMAT_WORD[idea.format] ?? "Reel"}</span>
          {idea.proof && idea.proof.support > 1 ? (
            <>
              <span>&middot;</span>
              <span>{idea.proof.support} accounts doing it</span>
            </>
          ) : null}
          {phaseWarn(idea.receipt.phase) ? (
            <>
              <span>&middot;</span>
              <span className="text-warn">{phaseWarn(idea.receipt.phase)}</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="border-t border-line/60 px-4 py-3">
        {songLed && idea.sound ? (
          <div className="mb-3 flex items-baseline justify-between gap-3 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted">The song</div>
              <p className="mt-0.5 truncate text-[14.5px] font-medium leading-snug">
                {plain(idea.sound)}
              </p>
            </div>
            <Copy text={plain(idea.sound)} />
          </div>
        ) : null}

        <div className={`${LABEL} mb-1.5`}>{openingLabel}</div>
        <p className="text-[17px] font-medium leading-snug">
          &ldquo;{plain(idea.hookVariants[active])}&rdquo;
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {idea.hookVariants.map((h, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-lg border px-2 text-[12px] transition ${
                i === active
                  ? "border-accent/50 bg-accent/10 text-text"
                  : "border-line text-muted hover:text-text"
              }`}
              title={plain(h)}
            >
              {i + 1}
            </button>
          ))}
          <Copy text={plain(idea.hookVariants[active])} />
        </div>

        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Borrowed from a {FORMAT_WORD[idea.format]?.toLowerCase() ?? "simple"}{" "}
          reel that did <span className="text-accent">{times(idea.receipt.ratio)}</span>{" "}
          @{idea.receipt.account}&rsquo;s usual views
          {idea.receipt.url ? (
            <>
              {" · "}
              <a
                href={idea.receipt.url}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-line underline-offset-2 hover:text-text"
              >
                see the post
              </a>
            </>
          ) : null}
          . Your angle: {lowerFirst(plain(idea.topic))}.
        </p>

        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-3 inline-flex min-h-[32px] items-center text-[12.5px] text-muted underline decoration-line underline-offset-2 transition hover:text-text"
        >
          {open ? "hide the script" : "full script, shots and caption"}
        </button>

        {open ? (
          <div className="mt-3 space-y-4 border-t border-line pt-3">
            <section>
              <h3 className={`${LABEL} mb-1.5`}>Beat by beat</h3>
              <ol className="space-y-1.5">
                {idea.beats.map((b, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-snug">
                    <span className="shrink-0 text-accent/70">{i + 1}</span>
                    <span>{plain(b)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h3 className={`${LABEL} mb-1.5`}>Shots</h3>
              <ul className="space-y-1">
                {idea.shotList.map((s, i) => (
                  <li key={i} className="text-[13px] leading-snug text-muted">
                    &middot; {plain(s)}
                  </li>
                ))}
              </ul>
            </section>

            {idea.onScreenText.length ? (
              <section>
                <h3 className={`${LABEL} mb-1.5`}>Text on screen</h3>
                <div className="flex flex-wrap gap-1.5">
                  {idea.onScreenText.map((t, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-line bg-panel2 px-2 py-1 text-[12px]"
                    >
                      {plain(t)}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            {idea.sound && !songLed ? (
              <section className="text-[13px] leading-snug">
                <h3 className={`${LABEL} mb-1.5`}>Sound</h3>
                {plain(idea.sound)}
                {idea.soundWindowDays
                  ? ` — use it within ${idea.soundWindowDays} days`
                  : ""}
              </section>
            ) : null}

            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <h3 className={LABEL}>Caption</h3>
                <Copy text={idea.caption} />
              </div>
              <p className="text-[13px] leading-snug">{plain(idea.caption)}</p>
              <p className="mt-1 text-[12px] text-muted">
                {idea.hashtags.join(" ")}
              </p>
            </section>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 px-4 py-2.5">
        <button
          onClick={() => patch({ status: "filmed" })}
          className="inline-flex min-h-[34px] items-center rounded-lg border border-line px-3 text-[12.5px] text-muted transition hover:text-text"
        >
          I made this
        </button>
        <button
          onClick={() => patch({ status: "posted" })}
          className="inline-flex min-h-[34px] items-center rounded-lg border border-line px-3 text-[12.5px] text-muted transition hover:text-text"
        >
          Posted it
        </button>
        <button
          onClick={() => patch({ status: "skipped" })}
          className="inline-flex min-h-[34px] items-center rounded-lg border border-line px-3 text-[12.5px] text-muted transition hover:text-text"
        >
          Not for me
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={views}
            onChange={(e) => setViews(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && saveViews()}
            onBlur={() =>
              views !== (idea.viewsAfter7d ? String(idea.viewsAfter7d) : "") &&
              saveViews()
            }
            placeholder="views it got"
            inputMode="numeric"
            aria-label="Views after a week"
            className="w-32 rounded-lg border border-line bg-panel2 px-2.5 py-2 text-[12px] tabular-nums outline-none placeholder:text-muted/50 focus:border-accent/50"
          />
          {saved ? <span className="text-[11px] text-accent">saved</span> : null}
        </div>
      </div>
    </article>
  );
}
