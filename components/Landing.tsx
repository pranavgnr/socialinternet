import ConnectHandle from "./ConnectHandle";
import NicheBubbles from "./NicheBubbles";
import SignInButton from "./SignInButton";
import { currentUser } from "@/lib/auth";
import { balance } from "@/lib/credits";
import { listTrending } from "@/lib/trending";

/**
 * The public front door.
 *
 * A server component so the trending list and the visitor's credit balance are
 * read once, on the server, before anything hydrates. `listTrending` is already
 * cached in-process by the trending module; this component deliberately adds no
 * second cache. The two inputs (handle and niche) are plain forms, so they work
 * with JavaScript off and with zero trending niches on disk.
 *
 * Anonymous visitors can browse everything here: a bubble opens a cached niche
 * for free. Only a fresh handle read or an unread niche asks them to sign in.
 */
export default async function Landing({
  initialNiche,
}: {
  /** set when the visitor picked a space on the discover page */
  initialNiche?: string;
}) {
  const [niches, user] = await Promise.all([
    listTrending(),
    currentUser().catch(() => null),
  ]);

  /**
   * A database blip must not take the front door down. The trending module
   * already falls back to disk; this guards the account read, which is the one
   * other request-time dependency on this page.
   */
  const credits = user ? await balance(user.id).catch(() => null) : null;

  return (
    <div className="space-y-8">
      <section className="pt-6">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
          For creators
        </p>
        <h1 className="mt-3 text-[32px] font-semibold leading-[1.06] tracking-tight sm:text-[42px]">
          Know what to post before you post it.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          The AI that works for creators.
        </p>
        <p className="mt-4 max-w-lg text-[14.5px] leading-relaxed text-muted">
          Put in your handle. We read your public posts, find what is already
          working for accounts your size, and give you what to make next — with
          the post that proves it.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted">
          {user ? (
            credits !== null ? (
              <span className="mono inline-flex min-h-[34px] items-center rounded-lg border border-line bg-panel px-3 text-[11.5px] text-text">
                {credits} credit{credits === 1 ? "" : "s"} left today
              </span>
            ) : (
              <span>Signed in</span>
            )
          ) : (
            <>
              <span>Already have an account?</span>
              <SignInButton
                label="Sign in with Google"
                className="inline-flex min-h-[34px] items-center rounded-lg border border-line bg-panel px-3 font-medium text-text transition hover:border-accent/50"
              />
            </>
          )}
        </div>
      </section>

      <ConnectHandle initialNiche={initialNiche} />

      <section className="border-t border-line/70 pt-5">
        <form action="/discover" method="get">
          <label
            htmlFor="niche-search"
            className="block text-[13px] font-medium text-text"
          >
            Or look at what&rsquo;s working in a niche
          </label>
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
            <input
              id="niche-search"
              name="q"
              placeholder="telugu music covers"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3.5 py-3.5 text-[16px] outline-none placeholder:text-muted/50 focus:border-accent/60"
            />
            <button
              type="submit"
              className="rounded-xl border border-line bg-panel px-5 py-3.5 text-[14px] font-semibold text-text transition active:scale-[0.99] hover:border-accent/50"
            >
              Look at this niche
            </button>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted/70">
            A space, not a handle — &ldquo;fitness for beginners&rdquo;,
            &ldquo;kannada singing&rdquo;, &ldquo;AI tools&rdquo;. Niches
            already looked at are free to reopen.
          </p>
        </form>
      </section>

      <NicheBubbles niches={niches} />
    </div>
  );
}
