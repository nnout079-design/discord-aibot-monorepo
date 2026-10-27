import OpenAI from "openai";
import { getDiagnosticSummary, recordDiagnostic } from "./diagnostics";
import { getGameState } from "./game-state";
import { suggestDeception } from "./deception";

export type SnipeRiskLevel = "low" | "elevated" | "high";

export interface SnipeRiskReport {
  level: SnipeRiskLevel;
  score: number;
  indicators: string[];
  countermeasures: string[];
}

// Evidence phrases that suggest an opponent is reading the stream for intel.
const SNIPE_SIGNALS: Array<{ indicator: string; terms: string[]; weight: number }> = [
  {
    indicator: "opponent appears to know concealed positions",
    terms: ["pre-aim", "preaim", "pre-fired", "waiting for you", "already aimed", "knew your position", "cornered"],
    weight: 3,
  },
  {
    indicator: "same opponent recurring across engagements",
    terms: ["same player", "same opponent", "again", "repeat encounter", "rematch"],
    weight: 2,
  },
  {
    indicator: "explicit stream-sniping cue in observed text",
    terms: ["stream snipe", "streamsnipe", "stream sniper", "watching your stream", "on your stream", "live stream"],
    weight: 4,
  },
  {
    indicator: "enemies converging on the streamer",
    terms: ["converging", "surrounded", "rotating to you", "hunting", "beeline"],
    weight: 2,
  },
  {
    indicator: "targeted harassment language in proximity",
    terms: ["kill cam", "tbag", "teabag", "clipping this", "clip it", "say hi to youtube"],
    weight: 1,
  },
];

// YouTube-specific countermeasures — the platform latency settings are the
// primary defense; everything else is camouflage.
export const COUNTERMEASURES = {
  platform: [
    "YouTube Studio -> Stream settings: set latency to Normal (adds ~15-30s). Ultra-low latency is effectively live and is what snipers exploit.",
    "Use 'Unlisted' or member-only streams when running competitive/ranked sessions.",
    "Turn on stream delay if broadcasting in a mode that supports it (Normal latency + encoder delay can buy 30-60s).",
  ],
  discipline: [
    "Hide the queue button and matchmaking pop with a scene/overlay between matches — snipers sync their queue off your screen.",
    "Randomize requeue timing: wait a non-constant 20-60s before queueing again.",
    "Cover the minimap/radar region with an overlay when playing hunt-style games.",
    "Do not read your exact position, objective, or loadout aloud between respawns.",
  ],
  tactical: [
    "After a suspicious death, change route AND timing — snipers bank on predictable resets.",
    "Deploy a deception tactic on stream to feed watchers false intent, then take the real route.",
    "If the same opponent name recurs, screenshot the account and report through the game's snipe-report channel.",
  ],
} as const;

function evidenceText(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function assessSnipeRisk(guildId: string, limit = 50): SnipeRiskReport {
  const summary = getDiagnosticSummary(guildId, limit);
  const indicators = new Set<string>();
  let score = 0;

  for (const signal of SNIPE_SIGNALS) {
    const hits = summary.recent.filter((item) => signal.terms.some((t) => evidenceText(item.event, item.detail, item.ruleId).includes(t)));
    if (hits.length > 0) {
      indicators.add(`${signal.indicator} (${hits.length} observation${hits.length === 1 ? "" : "s"})`);
      score += signal.weight * hits.length;
    }
  }

  const deaths = summary.recent.filter((item) => /died|death|defeat|eliminated|wasted|busted|killed|downed|game over/i.test(evidenceText(item.event, item.detail)));
  if (deaths.length >= 3) {
    indicators.add(`${deaths.length} deaths inside the observation window — consistent with a hunter tracking the stream`);
    score += deaths.length;
  }

  const level: SnipeRiskLevel = score >= 8 ? "high" : score >= 3 ? "elevated" : "low";
  const countermeasures = [
    ...COUNTERMEASURES.platform.slice(0, level === "low" ? 1 : 2),
    ...COUNTERMEASURES.discipline.slice(0, level === "high" ? 4 : 2),
    ...(level !== "low" ? COUNTERMEASURES.tactical : []),
  ];

  recordDiagnostic({
    guildId,
    channelId: "internal",
    game: getGameState(guildId)?.game ?? "unknown",
    source: "telemetry",
    stage: "rules",
    outcome: level === "low" ? "ok" : "degraded",
    event: "stream-snipe-assessment",
    detail: `Snipe risk ${level} (score ${score}): ${[...indicators].join("; ") || "no indicators"}`,
  });

  return { level, score, indicators: [...indicators], countermeasures };
}

export interface TiebreakAdvice {
  source: "openai" | "heuristic";
  assessment: string;
  plays: string[];
}

export async function adviseTiebreak(guildId: string, gameHint?: string): Promise<TiebreakAdvice> {
  const state = getGameState(guildId);
  const summary = getDiagnosticSummary(guildId, 15);
  const risk = assessSnipeRisk(guildId, 15);
  const recent = summary.recent
    .slice(-8)
    .map((item) => `${item.event ?? item.detail ?? item.stage}`)
    .join(" | ");

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const client = new OpenAI({ apiKey });
      const result = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "You are a military tactician advising a livestreamer in a tied/stalemated multiplayer match. Recommend 2-3 decisive tie-breaking plays. Constraints: prefer non-obvious timing so stream snipers cannot pre-read the play; note which suggestion to execute immediately vs after the stream delay covers it. Be terse and concrete.",
          },
          {
            role: "user",
            content: `Game: ${gameHint ?? state?.game ?? "unknown"}. Phase: ${state?.phase ?? "unknown"}. Latest event: ${state?.event ?? "none"}. Recent evidence: ${recent || "none"}. Stream-snipe risk: ${risk.level}.`,
          },
        ],
      });
      const text = result.choices[0]?.message.content?.trim() ?? "";
      if (text) {
        const plays = text
          .split(/\n+/)
          .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 4);
        return { source: "openai", assessment: `OpenAI analysis for ${gameHint ?? state?.game ?? "the current match"}`, plays };
      }
    } catch (error) {
      console.error("OpenAI tiebreak advice failed:", error);
    }
  }

  // Heuristic fallback — still breaks the tie without external calls.
  const deception = suggestDeception(guildId);
  const plays = [
    "Feint toward the most-watched objective, then rotate to the least-contested lane — the fake-out feeds stream snipers stale intel.",
    `Force a timing break: hold position through one full enemy push cycle, then commit during their reset (${deception.tactics[0]?.name ?? "decoy"} recommended as the cover action).`,
    "If tied on score, trade objective-for-frag rather than chasing kills — a defensible point converts the tie into a lead.",
  ];
  return { source: "heuristic", assessment: "OPENAI_API_KEY not configured — heuristic playbook", plays };
}
