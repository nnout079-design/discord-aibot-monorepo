/**
 * LLM machine-set awareness for the gaming companion.
 *
 * Tracks the inference services the companion depends on ("LLM machine
 * sets"): which ones exist, what resources each set is allocated, and
 * whether each is currently healthy. Services are polled on an interval;
 * state transitions (up -> down / down -> up) fire a callback so the
 * companion server can log and alert Discord.
 *
 * Status is exposed via getLlmStatus() for the /health payload and the
 * authed /stream/llm-status endpoint, and isServiceHealthy() lets the
 * ingest routes fast-fail instead of waiting on dead connections.
 */

export interface LlmMachineSet {
  /** Service name, e.g. "mental-health". */
  name: string;
  /** Base URL from env config, e.g. http://127.0.0.1:8000 on the matrix. */
  url: string;
  /** Health endpoint path. */
  healthPath: string;
  /** Allocated machine profile for this set (matches deploy/matrix/fly.toml). */
  profile: { cpus: number; memoryMb: number };
  /** Short description of what the set provides. */
  provides: string;
}

export interface LlmServiceStatus extends LlmMachineSet {
  configured: boolean;
  healthy: boolean;
  latencyMs: number | null;
  checkedAt: string | null;
  consecutiveFailures: number;
  detail: string | null;
  /** Model/service info reported by the service's /health payload, if any. */
  info: Record<string, unknown> | null;
}

export type LlmTransition = {
  service: string;
  from: "up" | "down" | "unknown";
  to: "up" | "down";
  latencyMs: number | null;
  detail: string | null;
};

const REGISTRY: LlmMachineSet[] = [
  {
    name: "mental-health",
    url: process.env.MENTAL_HEALTH_URL ?? "",
    healthPath: "/health",
    profile: {
      cpus: Number(process.env.LLM_MH_CPUS ?? 4),
      memoryMb: Number(process.env.LLM_MH_MEM_MB ?? 4096),
    },
    provides: "crisis classification, 28-label emotion analysis, triage, embeddings",
  },
  {
    name: "audio-events",
    url: process.env.AUDIO_EVENTS_URL ?? "",
    healthPath: "/health",
    profile: {
      cpus: Number(process.env.LLM_AE_CPUS ?? 2),
      memoryMb: Number(process.env.LLM_AE_MEM_MB ?? 2048),
    },
    provides: "AST audio classification, vehicle-noise detection",
  },
];

const status = new Map<string, LlmServiceStatus>();
const timers: NodeJS.Timeout[] = [];

for (const set of REGISTRY) {
  status.set(set.name, {
    ...set,
    configured: Boolean(set.url),
    healthy: false,
    latencyMs: null,
    checkedAt: null,
    consecutiveFailures: 0,
    detail: set.url ? "not yet checked" : "not configured",
    info: null,
  });
}

async function probe(set: LlmMachineSet): Promise<{ ok: boolean; latencyMs: number; info: Record<string, unknown> | null; detail: string | null }> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${set.url.replace(/\/$/, "")}${set.healthPath}`, {
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return { ok: false, latencyMs, info: null, detail: `HTTP ${response.status}` };
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: true, latencyMs, info: body, detail: null };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      info: null,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}

export function getLlmStatus(): LlmServiceStatus[] {
  return [...status.values()];
}

export function isServiceHealthy(name: string): boolean {
  const s = status.get(name);
  return Boolean(s && s.configured && s.healthy);
}

async function checkOnce(onTransition?: (t: LlmTransition) => void): Promise<void> {
  await Promise.all(
    REGISTRY.map(async set => {
      const current = status.get(set.name)!;
      if (!current.configured) return;

      const result = await probe(set);
      const previous: "up" | "down" | "unknown" =
        current.checkedAt === null ? "unknown" : current.healthy ? "up" : "down";

      current.healthy = result.ok;
      current.latencyMs = result.latencyMs;
      current.checkedAt = new Date().toISOString();
      current.detail = result.detail;
      if (result.info) current.info = result.info;
      current.consecutiveFailures = result.ok ? 0 : current.consecutiveFailures + 1;

      const now: "up" | "down" = result.ok ? "up" : "down";
      if (previous !== now) {
        onTransition?.({
          service: set.name,
          from: previous,
          to: now,
          latencyMs: result.latencyMs,
          detail: result.detail,
        });
      }
    }),
  );
}

/**
 * Begin polling the configured LLM machine sets. Safe to call once at
 * server startup; subsequent calls are no-ops.
 */
export function startLlmAwareness(options: {
  intervalMs?: number;
  onTransition?: (t: LlmTransition) => void;
} = {}): void {
  if (timers.length) return;
  const intervalMs = options.intervalMs ?? Number(process.env.LLM_STATUS_INTERVAL_MS ?? 30_000);
  void checkOnce(options.onTransition);
  timers.push(setInterval(() => void checkOnce(options.onTransition), intervalMs));
}
