"""Seed a synthetic vlog account + niche into the local cache so the real
pipeline can be exercised for the vlogger branch without spending credits.

Writes data/niches/daily-vlogs-india.json and data/handles/vlogyou.json.
Run scripts/clear-vlog-test.py afterwards to remove both.
"""
import json
import os
import random
from datetime import datetime, timedelta, timezone

random.seed(7)

NOW = datetime.now(timezone.utc)
NICHE_DIR = "data/niches"
HANDLE_DIR = "data/handles"

SHAPES = [
    ("day in my life as a college student in bangalore", ["vlog", "dayinmylife"], 55),
    ("morning routine before my 9am class", ["vlog", "morningroutine"], 48),
    ("come with me to the new cafe in indiranagar", ["vlog", "comewithme"], 62),
    ("storytime: the day my bike broke down in the rain", ["vlog", "storytime"], 70),
    ("pov: you are a hostel student on sunday", ["vlog", "pov"], 40),
    ("first time trying the metro in my city", ["vlog", "firsttime"], 52),
    ("things to do in goa on a budget", ["vlog", "placguide", "travel"], 65),
    ("behind the scenes of my first brand shoot", ["vlog", "behindthescenes"], 58),
    ("night routine after a 10 hour day", ["vlog", "nightroutine"], 50),
    ("how to film a vlog on just your phone", ["vlog", "howto"], 45),
]

accounts = [
    ("indianvlogger1", 12000),
    ("bangalorevlogs", 18000),
    ("hosteldiaries_ig", 9000),
    ("_daywithdisha", 26000),
    ("mumbaiwithaarav", 41000),
    ("collegelifeindia", 15000),
    ("thebudgetvlogger", 7000),
    ("northindianvlogs", 22000),
    ("sundaywithsana", 33000),
    ("shootwithkaran", 10500),
]


def reel(rid, account, followers, caption, tags, dur, views, baseline):
    return {
        "id": rid,
        "platform": "instagram",
        "account": account,
        "followers": followers,
        "url": f"https://www.instagram.com/reel/{rid}/",
        "caption": caption,
        "postedAt": (NOW - timedelta(days=random.randint(1, 40))).isoformat(),
        "views": views,
        "likes": int(views * 0.06),
        "comments": int(views * 0.004),
        "shares": int(views * 0.01),
        "saves": int(views * 0.02),
        "audioName": f"original audio - {account}",
        "durationSec": dur,
        "hashtags": tags,
        "nicheLabel": "vlog",
        "baselineMedianViews": baseline,
    }


payload = []
for i, (handle, followers) in enumerate(accounts):
    baseline = followers * 2  # a typical reel reaches about 2x followers
    # two posts that beat the account's usual, two that do not
    mults = [4.2, 3.1, 0.7, 0.9]
    picks = SHAPES[i % len(SHAPES) : i % len(SHAPES) + 2] or SHAPES[:2]
    if len(picks) < 2:
        picks = SHAPES[:2]
    for j, (caption, tags, dur) in enumerate(picks):
        views = int(baseline * mults[j])
        payload.append(
            reel(
                f"niche_{i}_{j}",
                handle,
                followers,
                caption,
                tags,
                dur,
                views,
                baseline,
            )
        )

os.makedirs(NICHE_DIR, exist_ok=True)
with open(os.path.join(NICHE_DIR, "daily-vlogs-india.json"), "w") as f:
    json.dump(
        {
            "fetchedAt": NOW.isoformat(),
            "payload": payload,
            "errors": [],
        },
        f,
    )

# the account being onboarded: 14k followers, 12 posts, half of them outliers
own_baseline = 18000
own = []
mults = [3.4, 1.1, 0.8, 2.9, 1.2, 0.6, 4.1, 1.0, 0.7, 1.6, 5.2, 0.9]
for k, m in enumerate(mults):
    caption, tags, dur = SHAPES[k % len(SHAPES)]
    own.append(
        reel(
            f"own_{k}",
            "vlogyou",
            14000,
            caption,
            tags,
            dur,
            int(own_baseline * m),
            own_baseline,
        )
    )

os.makedirs(HANDLE_DIR, exist_ok=True)
with open(os.path.join(HANDLE_DIR, "vlogyou.json"), "w") as f:
    json.dump(
        {
            "fetchedAt": NOW.isoformat(),
            "handle": "vlogyou",
            "reels": own,
            "niche": "daily vlogs india",
        },
        f,
    )

print(f"seeded niche reels={len(payload)} accounts={len(accounts)} own reels={len(own)}")
