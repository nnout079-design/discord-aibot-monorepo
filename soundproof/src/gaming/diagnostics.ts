import { createHash, randomUUID } from "node:crypto";

export type DiagnosticStage = "ingest" | "vision" | "audio" | "telemetry" | "rules" | "discord" | "external";
export type DiagnosticOutcome = "ok" | "degraded" | "failed" | "skipped";

export interface DiagnosticEvidence {
  id: string;
  guildId: string;
  channelId: string;
  game: string;
  source: "frame" | "audio" | "telemetry" | "replay";
  stage: DiagnosticStage;
  outcome: DiagnosticOutcome;
  observedAt: string;
  latencyMs?: number;
  event?: string;
  ruleId?: string;
  confidence?: number;
  detail?: string;
  contentHash?: string;
}

export interface DiagnosticFeedback {
  evidenceId: string;
  correct: boolean;
  expectedEvent?: string;
  note?: string;
}

export interface DiagnosticSummary {
  total: number;
  failures: number;
  degraded: number;
  averageLatencyMs: number;
  feedbackCount: number;
  accuracy?: number;
  likelyCauses: string[];
  recommendations: string[];
  recent: DiagnosticEvidence[];
}

export interface DeathPostmortem {
  detected: boolean;
  evidenceId?: string;
  confidence: number;
  cause: string;
  evidence: string[];
  repeatedPattern?: string;
  cycleRisk: "low" | "medium" | "high";
  preparation: string[];
  unknowns: string[];
}

const MAX_EVIDENCE = 500;
const evidenceByGuild = new Map<string, DiagnosticEvidence[]>();
const feedbackByEvidence = new Map<string, DiagnosticFeedback>();

export function hashObservation(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function recordDiagnostic(input: Omit<DiagnosticEvidence, "id" | "observedAt">): DiagnosticEvidence {
  const evidence: DiagnosticEvidence = { ...input, id: randomUUID(), observedAt: new Date().toISOString() };
  const entries = evidenceByGuild.get(input.guildId) ?? [];
  entries.push(evidence);
  if (entries.length > MAX_EVIDENCE) entries.splice(0, entries.length - MAX_EVIDENCE);
  evidenceByGuild.set(input.guildId, entries);
  return evidence;
}

export function recordDiagnosticFeedback(feedback: DiagnosticFeedback): boolean {
  const exists = [...evidenceByGuild.values()].some(entries => entries.some(entry => entry.id === feedback.evidenceId));
  if (!exists) return false;
  feedbackByEvidence.set(feedback.evidenceId, {
    ...feedback,
    expectedEvent: feedback.expectedEvent?.slice(0, 120),
    note: feedback.note?.slice(0, 500)
  });
  return true;
}

export function getDiagnosticSummary(guildId: string, limit = 25): DiagnosticSummary {
  const all = evidenceByGuild.get(guildId) ?? [];
  const recent = all.slice(-Math.max(1, Math.min(limit, 100)));
  const failures = recent.filter(item => item.outcome === "failed");
  const degraded = recent.filter(item => item.outcome === "degraded");
  const timed = recent.filter(item => item.latencyMs !== undefined);
  const feedback = recent.map(item => feedbackByEvidence.get(item.id)).filter((item): item is DiagnosticFeedback => Boolean(item));
  const stageFailures = new Map<DiagnosticStage, number>();
  for (const item of [...failures, ...degraded]) stageFailures.set(item.stage, (stageFailures.get(item.stage) ?? 0) + 1);
  const likelyCauses = [...stageFailures.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => `${stage}: ${count} failed or degraded observation${count === 1 ? "" : "s"}`);
  const recommendations: string[] = [];
  if (stageFailures.has("vision")) recommendations.push("Check vision API availability, frame encoding, and analysis latency.");
  if (stageFailures.has("audio")) recommendations.push("Check the audio-events service, clip format, and detection threshold.");
  if (stageFailures.has("telemetry")) recommendations.push("Ensure each observation includes game and event fields or produces usable model text.");
  if (stageFailures.has("rules")) recommendations.push("Compare expected events with rule keywords and cooldown suppression.");
  if (stageFailures.has("discord")) recommendations.push("Check channel permissions and whether the destination still exists.");
  if (!recommendations.length) recommendations.push("Collect feedback on recent evidence to measure false positives and missed events.");
  return {
    total: recent.length,
    failures: failures.length,
    degraded: degraded.length,
    averageLatencyMs: timed.length ? Math.round(timed.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0) / timed.length) : 0,
    feedbackCount: feedback.length,
    ...(feedback.length ? { accuracy: feedback.filter(item => item.correct).length / feedback.length } : {}),
    likelyCauses,
    recommendations,
    recent
  };
}

const deathTerms = ["died", "death", "defeat", "eliminated", "wasted", "busted", "killed", "downed", "game over"];
const causePatterns: Array<{ cause: string; terms: string[]; preparation: string }> = [
  { cause: "positioning or exposure", terms: ["ambush", "flank", "surrounded", "exposed", "open", "crossfire", "behind"], preparation: "Before re-engaging, identify cover, escape routes, and likely flank angles." },
  { cause: "resource or health pressure", terms: ["low health", "no ammo", "out of ammo", "reload", "healing", "fuel", "shield"], preparation: "Reset earlier when health, ammunition, fuel, or shields cross a safe threshold." },
  { cause: "movement or environmental hazard", terms: ["fall", "crash", "collision", "hazard", "storm", "zone", "fire", "explosion"], preparation: "Mark the environmental trigger and approach it more slowly with a recovery route." },
  { cause: "timing or repeated engagement", terms: ["rushed", "too late", "cooldown", "respawn", "again", "chased"], preparation: "Break the retry loop: pause, change timing or route, and wait for key cooldowns." },
  { cause: "opponent bait or misdirection", terms: ["bait", "decoy", "trap", "fake", "lured", "camp", "feint"], preparation: "Treat suspiciously easy opportunities as unverified; probe safely and preserve an exit." }
];

function normalizeEventText(item: DiagnosticEvidence): string {
  return `${item.event ?? ""} ${item.detail ?? ""}`.toLowerCase();
}

export function analyzeDeath(guildId: string, evidenceId?: string): DeathPostmortem {
  const all = evidenceByGuild.get(guildId) ?? [];
  let selectedIndex = evidenceId ? all.findIndex(item => item.id === evidenceId) : -1;
  if (!evidenceId) {
    for (let index = all.length - 1; index >= 0; index--) {
      if (deathTerms.some(term => normalizeEventText(all[index]).includes(term))) {
        selectedIndex = index;
        break;
      }
    }
  }
  if (selectedIndex < 0) return { detected: false, confidence: 0, cause: "No death or defeat evidence found", evidence: [], cycleRisk: "low", preparation: ["Submit explicit death/defeat telemetry and nearby observations for a grounded postmortem."], unknowns: ["No death observation is available."] };
  const selected = all[selectedIndex];
  const context = all.slice(Math.max(0, selectedIndex - 8), selectedIndex + 1);
  const combined = context.map(normalizeEventText).join(" ");
  if (!deathTerms.some(term => normalizeEventText(selected).includes(term))) return { detected: false, confidence: 0.2, cause: "Selected evidence does not identify a death", evidence: [selected.id], cycleRisk: "low", preparation: ["Select evidence that explicitly records a death or defeat."], unknowns: ["The outcome is not established by the selected evidence."] };
  const matches = causePatterns.map(pattern => ({ ...pattern, score: pattern.terms.filter(term => combined.includes(term)).length })).filter(pattern => pattern.score > 0).sort((a, b) => b.score - a.score);
  const primary = matches[0];
  const previousDeaths = all.slice(0, selectedIndex).filter(item => deathTerms.some(term => normalizeEventText(item).includes(term)));
  const similarDeaths = previousDeaths.filter(item => primary?.terms.some(term => normalizeEventText(item).includes(term))).length;
  const recentDeaths = previousDeaths.filter(item => Date.parse(selected.observedAt) - Date.parse(item.observedAt) <= 30 * 60 * 1000).length;
  const cycleRisk = similarDeaths >= 2 || recentDeaths >= 3 ? "high" : similarDeaths === 1 || recentDeaths >= 1 ? "medium" : "low";
  const evidence = context.filter(item => item.event || item.detail).slice(-5).map(item => `${item.id}: ${item.event ?? item.detail}`);
  const preparation = [
    primary?.preparation ?? "Capture more pre-death telemetry and avoid immediately repeating the same route or engagement.",
    ...(cycleRisk !== "low" ? ["Use a deliberate reset: change one variable at a time—route, timing, loadout, spacing, or objective—and compare outcomes."] : []),
    "Verify the hypothesis on the next attempt; do not treat inferred opponent intent or random events as known facts."
  ];
  return {
    detected: true,
    evidenceId: selected.id,
    confidence: Math.min(0.9, 0.45 + (primary?.score ?? 0) * 0.12 + Math.min(context.length, 5) * 0.04),
    cause: primary?.cause ?? "cause is not visible in available evidence",
    evidence,
    ...(similarDeaths ? { repeatedPattern: `${similarDeaths + 1} deaths share indicators of ${primary?.cause ?? "the same unresolved situation"}` } : {}),
    cycleRisk,
    preparation,
    unknowns: [
      ...(!primary ? ["No specific causal indicator was observed before the death."] : []),
      "Player intent, hidden enemies, network state, and unobserved game state remain unknown.",
      "Correlation across nearby observations does not prove causation."
    ]
  };
}

interface ReaProvider {
  name: "morluto/rea" | "mytechnotalent/rea";
  url?: string;
  token?: string;
}

export async function requestReaInvestigation(guildId: string): Promise<Array<{ provider: string; status: string; reference?: string }>> {
  const summary = getDiagnosticSummary(guildId, 50);
  const providers: ReaProvider[] = [
    { name: "morluto/rea", url: process.env.REA_MORLUTO_URL, token: process.env.REA_MORLUTO_TOKEN },
    { name: "mytechnotalent/rea", url: process.env.REA_AUTONOMOUS_URL, token: process.env.REA_AUTONOMOUS_TOKEN }
  ];
  return Promise.all(providers.map(async provider => {
    if (!provider.url) return { provider: provider.name, status: "not configured" };
    try {
      const response = await fetch(provider.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(provider.token ? { authorization: `Bearer ${provider.token}` } : {}) },
        body: JSON.stringify({
          authorizationScope: "owned-or-authorized-defensive-diagnostics",
          exclusions: ["anti-cheat bypass", "memory manipulation", "multiplayer automation"],
          question: "Identify likely causes of AI, bot, streaming, telemetry, rule, or repeated defeat failures from this redacted evidence summary. Separate observed facts, inferences, and unknowns, then suggest legitimate preventive coaching.",
          summary: { ...summary, recent: summary.recent.map(({ contentHash, ...item }) => ({ ...item, contentHash })) },
          postmortem: analyzeDeath(guildId)
        }),
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as { id?: string; reference?: string };
      return { provider: provider.name, status: "submitted", reference: result.id ?? result.reference };
    } catch (error) {
      return { provider: provider.name, status: `unavailable (${error instanceof Error ? error.message : "unknown error"})` };
    }
  }));
}
