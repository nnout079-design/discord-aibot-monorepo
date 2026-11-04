/**
 * Matrix supervisor: runs every Discord bot and both LLM inference
 * services in one container on a single Fly performance-8x machine
 * (8 dedicated cores / 16 GB RAM).
 *
 * - Spawns each service with its own memory ceiling (--max-old-space-size
 *   for node, uvicorn workers=1 for python so each model loads once).
 * - Restarts crashed services with capped exponential backoff.
 * - GET http://127.0.0.1:8090/matrix-status reports process liveness and
 *   HTTP health per service (fly ssh for inspection).
 * - Forwards SIGTERM/SIGINT to all children for clean Fly deploys.
 */

import { spawn } from "node:child_process";
import http from "node:http";

const PY = "/opt/llm-venv/bin/python";

// Budget tuned for 8 cores / 16 GB:
//   mental-health 4c/4G, audio-events 2c/2G (inference is the CPU load),
//   soundproof 1.5G, other bots 384-768 MB each, ~4.5G headroom for HF
//   cache, OS, and node overhead.
const SERVICES = [
  {
    name: "mental-health",
    argv: [PY, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1"],
    cwd: "/app/services/mental-health",
    env: { PYTHONPATH: "/app/services/mental-health", PORT: "8000" },
    health: "http://127.0.0.1:8000/health",
  },
  {
    name: "audio-events",
    argv: [PY, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", "8100", "--workers", "1"],
    cwd: "/app/services/audio-events",
    env: { PYTHONPATH: "/app/services/audio-events", PORT: "8100" },
    health: "http://127.0.0.1:8100/health",
  },
  {
    name: "soundproof",
    argv: ["node", "--max-old-space-size=1536", "dist/index.js"],
    cwd: "/app/bots/soundproof",
    env: { PORT: "3000" },
    health: "http://127.0.0.1:3000/health",
  },
  {
    name: "discord-aibot",
    argv: ["node", "--max-old-space-size=768", "dist/index.js"],
    cwd: "/app/bots/discord-aibot",
    health: "http://127.0.0.1:3004/health",
  },
  {
    name: "lastfm-client",
    argv: ["node", "--max-old-space-size=768", "dist/index.js"],
    cwd: "/app/bots/lastfm-client",
    env: { PORT: "8081" },
  },
  {
    name: "lkeff-listen",
    argv: ["node", "--max-old-space-size=384", "dist/index.js"],
    cwd: "/app/bots/lkeff-listen",
  },
  {
    name: "airhornbot",
    argv: ["node", "--max-old-space-size=384", "dist/index.js"],
    cwd: "/app/bots/airhornbot",
  },
  {
    name: "modbot",
    argv: ["node", "--max-old-space-size=384", "dist/index.js"],
    cwd: "/app/bots/modbot",
  },
];

const STATUS_PORT = Number(process.env.MATRIX_STATUS_PORT ?? 8090);
const MAX_BACKOFF_MS = 30_000;

const procs = new Map();

function start(service) {
  const state = procs.get(service.name);
  const child = spawn(service.argv[0], service.argv.slice(1), {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  state.child = child;
  state.startedAt = Date.now();
  state.healthy = null;

  const tag = `[${service.name}]`;
  child.stdout.on("data", d => process.stdout.write(`${tag} ${d}`));
  child.stderr.on("data", d => process.stderr.write(`${tag} ${d}`));
  child.on("exit", (code, signal) => {
    if (state.stopping) return;
    state.child = null;
    state.healthy = false;
    const uptime = Date.now() - state.startedAt;
    // reset backoff if the service stayed up for a while
    state.backoffMs = uptime > 300_000 ? 1_000 : Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
    console.error(`[matrix] ${service.name} exited code=${code} signal=${signal}; restart in ${state.backoffMs}ms`);
    setTimeout(() => !state.stopping && start(service), state.backoffMs);
  });
}

for (const service of SERVICES) {
  procs.set(service.name, { service, child: null, backoffMs: 1_000, startedAt: 0, healthy: null, stopping: false });
  start(service);
}

// ---- health probing + status endpoint ----

async function probe(url) {
  const t = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    return { ok: r.ok, latencyMs: Date.now() - t };
  } catch {
    return { ok: false, latencyMs: Date.now() - t };
  }
}

async function snapshot() {
  const out = {};
  await Promise.all(
    SERVICES.map(async s => {
      const st = procs.get(s.name);
      const health = s.health ? await probe(s.health) : null;
      if (health) st.healthy = health.ok;
      out[s.name] = {
        running: Boolean(st.child),
        pid: st.child?.pid ?? null,
        healthy: st.healthy,
        latencyMs: health?.latencyMs ?? null,
        backoffMs: st.backoffMs,
      };
    }),
  );
  return out;
}

http
  .createServer(async (_req, res) => {
    const body = JSON.stringify({ ok: true, matrix: await snapshot() });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  })
  .listen(STATUS_PORT, "127.0.0.1", () =>
    console.log(`[matrix] status on http://127.0.0.1:${STATUS_PORT}/matrix-status`),
  );

setInterval(() => void snapshot(), 30_000);

// ---- shutdown ----

function shutdown(signal) {
  console.log(`[matrix] ${signal} received, stopping services`);
  for (const st of procs.values()) {
    st.stopping = true;
    st.child?.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const st of procs.values()) st.child?.kill("SIGKILL");
    process.exit(0);
  }, 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
