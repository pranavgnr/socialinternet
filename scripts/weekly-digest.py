#!/usr/bin/env python3
"""Print the latest weekly digest as a phone-friendly Telegram message.

Reads the newest data/accounts/*/weekly.json and formats it. Costs no
SocialCrawl credits — it only re-reads what was already paid for.

Usage:
  python3 scripts/weekly-digest.py [--handle natgeotravel]
"""

import glob
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IST = timezone(timedelta(hours=5, minutes=30))


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def human(n) -> str:
    if n is None:
        return "—"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M".replace(".0M", "M")
    if n >= 1_000:
        return f"{round(n/1_000)}k"
    return str(n)


def load(handle=None):
    best = None
    for path in glob.glob(os.path.join(ROOT, "data", "accounts", "*", "weekly.json")):
        try:
            entries = json.load(open(path))
        except Exception:
            continue
        for e in entries:
            if handle and e.get("handle", "").lower() != handle.lower():
                continue
            key = (e.get("weekOf", ""), e.get("generatedAt", ""))
            if best is None or key > best[0]:
                best = (key, e)
    return best[1] if best else None


def render(d: dict) -> str:
    today = datetime.now(IST).date()
    this_monday = monday_of(today)
    week_of = datetime.strptime(d["weekOf"], "%Y-%m-%d").date()
    age_days = (this_monday - week_of).days

    s = d.get("standing", {})
    out = []
    out.append(f"📊 @{d['handle']} — week of {week_of.strftime('%d %b')}")

    if age_days > 0:
        out.append(
            f"⚠️ This is {age_days // 7} week(s) old. "
            "Refresh on /weekly to re-pull (needs SocialCrawl credits)."
        )
    else:
        out.append("✅ Fresh this week.")

    out.append("")
    out.append("Standing")
    out.append(f"• Typical reel: {human(s.get('medianViews'))} views")
    out.append(f"• Best reel: {human(s.get('bestViews'))} views")
    if s.get("vsNiche"):
        out.append(
            f"• vs niche ({human(s.get('nicheMedianViews'))}): {s['vsNiche']}×"
        )
    if s.get("followers"):
        out.append(f"• Followers: {human(s.get('followers'))}")

    changes = d.get("changes") or []
    if changes:
        out.append("")
        out.append("What changed")
        for c in changes[:4]:
            out.append(f"• {c.get('text') or c.get('title') or c}")

    moves = d.get("moves") or []
    if moves:
        out.append("")
        out.append("Moves, in order")
        for i, m in enumerate(moves[:3], 1):
            out.append(f"{i}. {m.get('title','').strip()}")
            if m.get("action"):
                out.append(f"   → {m['action'].strip()}")

    ideas = d.get("ideas") or []
    if ideas:
        out.append("")
        out.append("This week's posts")
        for i, idea in enumerate(ideas[:3], 1):
            out.append(f"{i}. {idea.get('title','').strip()}")
            if idea.get("hook"):
                out.append(f"   Open with: {idea['hook'].strip()}")

    out.append("")
    out.append("Full detail → /weekly")
    return "\n".join(out)


def main():
    handle = None
    if "--handle" in sys.argv:
        handle = sys.argv[sys.argv.index("--handle") + 1]
    d = load(handle)
    if not d:
        who = f" for @{handle}" if handle else ""
        print(f"No weekly digest found{who}. Analyse a handle first, then make a week.")
        return 1
    print(render(d))
    return 0


if __name__ == "__main__":
    sys.exit(main())
