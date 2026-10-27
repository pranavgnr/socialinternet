import type { RawReel, SoundStats } from "./types";

/**
 * Demo corpus. Realistic shape: every account has its own baseline, most reels
 * land near it, and a couple break out — so the outlier math has something true
 * to find. Used when no API keys are configured, so the site is explorable and
 * the whole pipeline can be checked end to end.
 */

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

interface Account {
  handle: string;
  followers: number;
  baseline: number;
  /** [daysAgo, views, caption, audioId] */
  reels: [number, number, string, string][];
}

const BREAKOUTS: Account[] = [
  {
    handle: "aiautomation.lab",
    followers: 184_000,
    baseline: 9_400,
    reels: [
      [1, 61_000, "Why your AI agent loops forever (and the 90-second fix)", "snd_hookloop"],
      [3, 39_000, "How I price an automation retainer so clients say yes", "snd_ghost"],
      [2, 214_000, "I automated my whole client onboarding with one Make scenario. 6 hours a week back.", "snd_ghost"],
      [6, 11_000, "Three n8n nodes everyone forgets to use", "snd_neutral1"],
      [9, 7_800, "How I name my automations so I never lose one", "snd_neutral2"],
      [13, 12_400, "Stop paying for Zapier if you only use 3 zaps", "snd_neutral1"],
      [17, 8_900, "My Monday automation audit in 4 minutes", "snd_neutral3"],
      [22, 9_600, "The trigger I use for every new lead", "snd_neutral2"],
      [26, 6_400, "Why your webhook keeps failing (it's the header)", "snd_neutral3"],
      [31, 10_200, "One prompt that writes my SOPs", "snd_neutral1"],
      [37, 8_100, "Automating invoices without a paid tool", "snd_neutral2"],
      [44, 11_800, "The four flows every agency needs", "snd_neutral4"],
      [52, 7_200, "My favourite free alternative to Airtable automations", "snd_neutral3"],
      [61, 9_900, "Testing an AI agent on a real client task", "snd_neutral1"],
    ],
  },
  {
    handle: "buildwith.ai",
    followers: 96_000,
    baseline: 5_200,
    reels: [
      [1, 29_000, "My AI agent looped for 3 days straight. One line fixed it.", "snd_hookloop"],
      [3, 96_000, "I built a lead-scoring bot in 40 minutes. Free tier only. Here's the build.", "snd_ghost"],
      [5, 4_100, "Why I stopped using 12 tools", "snd_neutral4"],
      [8, 6_300, "The one setting that fixed my AI output", "snd_neutral2"],
      [12, 3_900, "Prompt structure I use for every client", "snd_neutral1"],
      [16, 5_800, "Building in public week 12: the numbers", "snd_neutral3"],
      [21, 4_400, "A free way to test AI agents", "snd_neutral2"],
      [27, 7_100, "My stack costs $23/month. Full list.", "snd_neutral4"],
      [33, 4_800, "The AI tool I cancelled this month", "snd_neutral1"],
      [41, 5_500, "How to scope an automation project", "snd_neutral3"],
      [49, 3_600, "Debugging an agent loop in 30 seconds", "snd_neutral2"],
      [58, 6_200, "What I'd build first if I started today", "snd_neutral4"],
      [66, 4_300, "Cheapest way to run a local model", "snd_neutral1"],
    ],
  },
  {
    handle: "theopsguy",
    followers: 61_000,
    baseline: 3_800,
    reels: [
      [2, 19_500, "Pricing an automation retainer: the 3 numbers I actually use", "snd_ghost"],
      [1, 47_000, "Spent $0 on ads. 11 reels. One format did all the work.", "snd_hookloop"],
      [4, 3_100, "The dashboard nobody looks at", "snd_neutral3"],
      [7, 4_500, "My 11-minute weekly review", "snd_neutral1"],
      [11, 3_400, "A naming convention that saved me a week", "snd_neutral2"],
      [15, 5_200, "Stop automating before you document", "snd_neutral4"],
      [20, 2_900, "One spreadsheet beats five apps", "snd_neutral3"],
      [25, 4_100, "The handoff doc template I reuse", "snd_neutral1"],
      [32, 3_700, "What I check before every launch", "snd_neutral2"],
      [40, 4_600, "My cheapest client-gift automation", "snd_neutral4"],
      [48, 3_200, "Why your SOPs get ignored", "snd_neutral3"],
      [57, 5_000, "The 3 lines I add to every brief", "snd_neutral1"],
      [65, 3_500, "Pricing an automation retainer", "snd_neutral2"],
    ],
  },
  {
    handle: "solofounder.files",
    followers: 38_000,
    baseline: 2_600,
    reels: [
      [3, 9_800, "I let an AI agent loop for a week. It cost $40 and taught me one rule.", "snd_hookloop"],
      [2, 31_000, "I quit my tools for 7 days. Revenue went up.", "snd_hookloop"],
      [5, 2_200, "My first 100 users came from one comment", "snd_neutral2"],
      [9, 3_100, "The pricing page mistake I made twice", "snd_neutral1"],
      [14, 1_900, "Building an audience with zero posts", "snd_neutral4"],
      [18, 2_800, "What I ship on Mondays", "snd_neutral3"],
      [24, 2_400, "My refund policy for AI work", "snd_neutral2"],
      [30, 3_400, "The boring metric that predicts churn", "snd_neutral1"],
      [38, 2_100, "How I answer 'can AI do this'", "snd_neutral4"],
      [46, 2_900, "A scope creep script that works", "snd_neutral3"],
      [55, 2_300, "One week, no meetings: the log", "snd_neutral2"],
      [63, 3_000, "What I learned from 40 cold DMs", "snd_neutral1"],
      [71, 2_500, "My tool budget after cutting 60%", "snd_neutral4"],
    ],
  },
  {
    handle: "automate.daily",
    followers: 240_000,
    baseline: 14_000,
    reels: [
      [4, 380_000, "3 AI tools that replaced 3 freelancers (with receipts)", "snd_ghost"],
      [7, 12_100, "Speed-run: one automation in 60 seconds", "snd_neutral1"],
      [10, 16_400, "The workflow I'd sell for $2k", "snd_neutral2"],
      [16, 11_200, "Free AI stack for 2026", "snd_neutral4"],
      [23, 15_300, "Why your agent loops forever", "snd_neutral3"],
      [29, 13_400, "My client onboarding in 4 steps", "snd_neutral1"],
      [35, 12_900, "The tool I regret buying", "snd_neutral2"],
      [43, 17_200, "Reading an API doc in 5 minutes", "snd_neutral4"],
      [51, 10_800, "Batch content with one script", "snd_neutral3"],
      [60, 14_600, "What I automate and what I never will", "snd_neutral1"],
      [68, 12_300, "The 3 questions before any build", "snd_neutral2"],
      [75, 13_100, "A cheaper vector database", "snd_neutral4"],
    ],
  },
  {
    handle: "quiet.operator",
    followers: 17_000,
    baseline: 1_800,
    reels: [
      [4, 8_100, "What I charge for an automation retainer, line by line", "snd_ghost"],
      [3, 22_000, "Nobody warns you what client automation actually costs", "snd_hookloop"],
      [8, 1_500, "My note system in 90 seconds", "snd_neutral2"],
      [12, 2_000, "The email that closes 30% of my deals", "snd_neutral1"],
      [19, 1_700, "One rule for saying no", "snd_neutral4"],
      [25, 2_300, "How I keep a client for 3 years", "snd_neutral3"],
      [34, 1_600, "A quiet week in the business", "snd_neutral2"],
      [42, 1_900, "What I charge for and what I give away", "snd_neutral1"],
      [50, 2_100, "The doc I send before every call", "snd_neutral4"],
      [59, 1_400, "Why I don't do retainers", "snd_neutral3"],
      [67, 1_800, "My three-tool stack", "snd_neutral2"],
      [74, 2_200, "Handling the 'can you just' request", "snd_neutral1"],
    ],
  },
];

function filler(account: string, baseline: number): RawReel[] {
  const topics = [
    "A small automation that saves 20 minutes",
    "The checklist I run before publishing",
    "One thing I changed in my workflow",
    "Answering a question from the comments",
    "A tool comparison nobody asked for",
    "What my Monday looks like",
  ];
  return topics.map((t, i) => ({
    id: `instagram_fill_${account}_${i}`,
    platform: "instagram" as const,
    account,
    followers: baseline * 6,
    url: `https://instagram.com/reel/fill-${account}-${i}`,
    caption: t,
    postedAt: ago(6 + i * 7),
    views: Math.round(baseline * (0.7 + ((i * 37) % 60) / 100)),
    likes: Math.round(baseline * 0.05),
    comments: Math.round(baseline * 0.004),
    audioId: `snd_fill${i}`,
  }));
}

export function demoReels(): RawReel[] {
  const out: RawReel[] = [];
  for (const acc of BREAKOUTS) {
    for (const [days, views, caption, audioId] of acc.reels) {
      out.push({
        id: `instagram_${acc.handle}_${days}`,
        platform: "instagram",
        account: acc.handle,
        followers: acc.followers,
        url: `https://instagram.com/reel/${acc.handle}-${days}`,
        caption,
        postedAt: ago(days),
        views,
        likes: Math.round(views * (0.035 + (days % 5) / 100)),
        comments: Math.round(views * 0.004),
        shares: Math.round(views * 0.012),
        audioId,
        audioName:
          audioId === "snd_ghost"
            ? "ghost.mp3 (sped up)"
            : audioId === "snd_hookloop"
              ? "hook loop — original audio"
              : `library track ${audioId.slice(-1)}`,
        transcript: caption,
        onScreenText: caption.split(" ").slice(0, 4).join(" "),
      });
    }
    out.push(...filler(acc.handle, acc.baseline));
  }

  // a couple of YouTube shorts so multi-source shape is visible
  out.push(
    {
      id: "youtube_demo_1",
      platform: "youtube",
      account: "theopsguy",
      url: "https://youtube.com/watch?v=demo1",
      caption: "I automated my invoices and it broke in 4 days",
      postedAt: ago(5),
      views: 88_000,
      likes: 4_100,
      comments: 310,
    },
    {
      id: "youtube_demo_2",
      platform: "youtube",
      account: "theopsguy",
      url: "https://youtube.com/watch?v=demo2",
      caption: "The cheapest AI stack that actually works",
      postedAt: ago(19),
      views: 6_200,
      likes: 290,
      comments: 22,
    },
  );

  return out;
}

export function demoSoundStats(): Record<string, SoundStats> {
  return {
    snd_ghost: {
      audioId: "snd_ghost",
      reelsLast7d: 1_240,
      reelsPrev7d: 410,
      uniqueAuthors: 38,
      largeAuthorShare: 0.18,
      brandShare: 0.02,
      firstSeenDaysAgo: 12,
    },
    snd_hookloop: {
      audioId: "snd_hookloop",
      reelsLast7d: 2_900,
      reelsPrev7d: 2_400,
      uniqueAuthors: 96,
      largeAuthorShare: 0.42,
      brandShare: 0.05,
      firstSeenDaysAgo: 34,
    },
    snd_neutral1: {
      audioId: "snd_neutral1",
      reelsLast7d: 120,
      reelsPrev7d: 180,
      uniqueAuthors: 14,
      largeAuthorShare: 0.1,
      brandShare: 0,
      firstSeenDaysAgo: 90,
    },
  };
}
