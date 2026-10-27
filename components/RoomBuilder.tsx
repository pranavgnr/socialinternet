"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import RoomPlanView from "@/components/RoomPlanView";
import type { RoomPlan } from "@/lib/newcomer";

/**
 * Builds the room plan, once, when the visitor lands on it.
 *
 * Reading a room is a real pull — a search plus several channel reads — so it
 * can take half a minute the first time and nothing at all afterwards, because
 * research is kept on disk. The waiting screen says which of those it is, since
 * a phone that sits on "loading" for thirty seconds reads as broken.
 */
export default function RoomBuilder({ query }: { query: string }) {
  const [room, setRoom] = useState<RoomPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const started = useRef(false);

  const run = useCallback(async (q: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        room?: RoomPlan;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.room) {
        throw new Error(json.error ?? "That did not work. Try again in a moment.");
      }
      setRoom(json.room);
    } catch (err) {
      setError((err as Error).message || "That did not work. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!query || started.current) return;
    started.current = true;
    void run(query);
  }, [query, run]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  if (!query) {
    return (
      <div className="space-y-4 pt-4">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
          Pick a space first
        </h1>
        <p className="text-[14px] leading-relaxed text-muted">
          A plan for someone starting from zero is built from a room, not from an
          account. Say what you know and the rooms get priced for you.
        </p>
        <Link
          href="/start"
          className="block rounded-xl bg-accent px-4 py-3.5 text-center text-[14px] font-semibold text-black"
        >
          Find my space
        </Link>
      </div>
    );
  }

  if (room) {
    return (
      <div className="space-y-6">
        <RoomPlanView room={room} />
        <p className="text-center text-[11.5px] text-muted/60">
          <Link
            href={`/discover?q=${encodeURIComponent(room.query)}`}
            className="underline decoration-line underline-offset-2 hover:text-text"
          >
            See the accounts behind this
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-4">
      <p className="text-[11.5px] font-medium uppercase tracking-[0.16em] text-accent">
        Reading the room
      </p>
      <h1 className="text-[26px] font-semibold leading-[1.15] tracking-tight sm:text-[30px]">
        {query}
      </h1>

      {error ? (
        <>
          <p className="rounded-xl border border-bad/40 bg-bad/5 px-3.5 py-3 text-[13px] leading-relaxed text-bad">
            {error}
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                started.current = true;
                setSeconds(0);
                void run(query);
              }}
              className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-[13.5px] font-medium transition active:scale-[0.99]"
            >
              Try again
            </button>
            <Link
              href="/start"
              className="block rounded-xl bg-accent px-4 py-3 text-center text-[13.5px] font-semibold text-black"
            >
              Pick a different space
            </Link>
          </div>
        </>
      ) : (
        <>
          <ol className="space-y-2 text-[13px] leading-relaxed text-muted">
            <li>Finding the accounts posting here…</li>
            <li>Reading enough of each to know their usual views…</li>
            <li>Working out what the posts that broke out have in common…</li>
          </ol>
          <p className="mono text-[11px] text-muted/60">
            {seconds}s{seconds > 8 ? " — first read of a space takes about 30s" : ""}
          </p>
        </>
      )}
    </div>
  );
}
