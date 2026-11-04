# Agent Notes: Mental Health Feature

# Agent Notes: Vehicle-Noise Audio Events Feature

## What changed

- Added a dedicated Python inference service at `services/audio-events/`.
  - Runs a FastAPI app with `/health`, `/classify`, `/vehicle`, and `/metrics` endpoints.
  - Default model: `MIT/ast-finetuned-audioset-10-10-0.4593` (Audio Spectrogram Transformer, 527 AudioSet labels, multi-label).
  - Vehicle labels are configured as case-insensitive substrings in `config/vehicle-labels.json`.
  - Accepts `audio_base64` (WAV/FLAC/OGG), decodes via `soundfile`, resamples to 16 kHz, returns `is_vehicle` + `top_label` + detections.
  - Exposes Prometheus metrics for requests, vehicle detections, and inference latency.

- Vehicle-noise callbacks in `soundproof`:
  - `src/streaming/audio-events-client.ts` — HTTP client for `/vehicle` (disabled when `AUDIO_EVENTS_URL` is unset).
  - `src/streaming/vehicle-callback.ts` — routes detections through the existing `updateGameState → evaluateGameRules` pipeline to post a Discord channel message, and POSTs a JSON event to `VEHICLE_NOISE_WEBHOOK_URL` when configured.
  - `POST /stream/audio` on the companion server — capture clients upload base64 audio clips (same `x-stream-token` auth as `/stream/frame`).
  - `voice-transcriber.ts` — runs vehicle-noise detection alongside Whisper transcription on voice-channel audio.
  - New rules in `src/gaming/rules.ts`: `vehicle-siren`, `vehicle-aircraft`, `vehicle-horn`, `vehicle-engine`, `vehicle-generic` match `vehicle-noise` events.

## Environment variables

```env
# soundproof
AUDIO_EVENTS_URL=http://localhost:8100          # http://audio-events:8100 in compose
VEHICLE_NOISE_WEBHOOK_URL=                      # optional outbound callback
VEHICLE_NOISE_THRESHOLD=0.4

# services/audio-events
MODEL_ID=MIT/ast-finetuned-audioset-10-10-0.4593
VEHICLE_THRESHOLD=0.4
MAX_CLIP_SECONDS=30
VEHICLE_LABELS_PATH=config/vehicle-labels.json
```

In production, `soundproof/fly.toml` points `AUDIO_EVENTS_URL` at
`https://discord-audio-events-service.fly.dev`; the service deploys as the
`discord-audio-events-service` Fly app (`services/audio-events/fly.toml`).

## Pushing a game audio clip

```bash
curl -X POST http://localhost:3000/stream/audio \
  -H "content-type: application/json" \
  -H "x-stream-token: $STREAM_INGEST_TOKEN" \
  -d '{"guildId":"...","channelId":"...","game":"star citizen","audioBase64":"'"$(base64 -w0 clip.wav)"'"}'
```

# Agent Notes: Mental Health Feature

## What changed

- Added a dedicated Python inference service at `services/mental-health/`.
  - Runs a FastAPI app with `/health`, `/analyze`, `/crisis`, `/emotion`, `/embed`, and `/metrics` endpoints.
  - Loads a configurable model catalog from `config/models.yaml`.
  - Ships with two default models:
    - `Akashpaul123/modernbert-crisis-detection` — binary crisis/safe classification.
    - `cirimus/modernbert-large-go-emotions` — 28-label multi-label emotion classification.
  - Optional embedding models:
    - `answerdotai/ModernBERT-large` — general embeddings.
    - `AIMH/mental-bert-large-uncased` — mental-health-domain embeddings.
  - Applies a safety/triage policy in `src/safety.py` and returns suggested resources from `config/resources.json`.
  - Exposes Prometheus metrics for requests, crisis detections, and inference latency.

- Added `/wellness` slash commands to every Discord bot:
  - `/wellness check <message>` — analyze crisis risk, emotions, and triage level.
  - `/wellness resources` — list crisis support resources.
  - `discord-aibot` also screens `/ask` prompts before calling Claude and short-circuits with a safety response if crisis risk is high.

- Each bot has a local HTTP client at `src/reasoning/engines/mental-health-client.ts` that talks to the service.

## Environment variables

All bots need `MENTAL_HEALTH_URL` pointing at the service, e.g.:

```env
MENTAL_HEALTH_URL=http://localhost:8000
```

In Docker Compose the service is reachable at `http://mental-health:8000`.

## Running locally

1. Start the Python service:

```bash
cd services/mental-health
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

2. In another terminal, run any bot:

```bash
cd discord-aibot
cp .env.example .env
# fill in DISCORD_TOKEN, CLAUDE_API_KEY, MENTAL_HEALTH_URL
npm install
npm run build
npm start
```

## Docker Compose

The `mental-health` service is defined in `docker-compose.yml` with a 2 vCPU / 4 GB RAM limit.
ModernBERT-large is memory-hungry; if you disable the large emotion model and only use the crisis model (ModernBERT-base), you can lower this to 2 GB.

```bash
docker compose up --build mental-health discord-aibot
```

## Adding or swapping a model

Edit `services/mental-health/config/models.yaml`:

```yaml
my_classifier:
  task: text-classification
  model_id: your-hf-username/your-model
  threshold: 0.5
  enabled: true
```

Restart the service. The bot client code does not need to change.

## Fine-tuning a custom model

Place a CSV with `text` and `label` columns in `services/mental-health/data/`.

```bash
cd services/mental-health
python -m training.finetune \
  --model_id answerdotai/ModernBERT-large \
  --dataset_csv data/your-data.csv \
  --output_dir ./outputs/my-classifier \
  --num_epochs 3
```

Then export to ONNX if desired:

```bash
python -m training.export_onnx \
  --model_path ./outputs/my-classifier/model \
  --output_path ./outputs/my-classifier/model.onnx
```

## Safety reminders

- This bot is **not** a substitute for professional mental health care.
- The crisis classifier is a supportive triage tool, not a diagnosis.
- Do not use real user messages to train models without explicit consent and a privacy review.
- Store hashed/anonymized user IDs and keep a clear retention policy.
- Always provide human escalation paths (mod roles, crisis resources, emergency services).

## Build verification

```bash
# TypeScript bots
cd discord-aibot && npm run build
cd ../soundproof && npm run build
cd ../lkeff-listen && npm run build
cd ../airhornbot && npm run build
cd ../lastfm-client && npm run build

# Python service
cd ../services/mental-health
python -m compileall src training
```

## Deploying to Fly.io

A `fly.toml` is provided for every service/bot:

- `services/mental-health/fly.toml`
- `discord-aibot/fly.toml`
- `soundproof/fly.toml`
- `lkeff-listen/fly.toml`
- `airhornbot/fly.toml`
- `lastfm-client/fly.toml`

### One-time setup

1. Install `flyctl` and authenticate:

```bash
fly auth login
```

2. Create each Fly app (or run `fly launch --no-deploy` once per app):

```bash
fly apps create discord-mental-health-service
fly apps create discord-aibot
fly apps create discord-soundproof-bot
fly apps create discord-lkeff-listen-bot
fly apps create discord-airhornbot
fly apps create discord-lastfm-client
```

3. Set secrets per app. At minimum each bot needs `DISCORD_TOKEN` and, where applicable, `CLAUDE_API_KEY` or `LASTFM_API_KEY`:

```bash
fly secrets set DISCORD_TOKEN=xxx -a discord-aibot
fly secrets set CLAUDE_API_KEY=xxx -a discord-aibot
```

For the mental-health service you can optionally set `HF_TOKEN` if you use gated models.

### Deploy manually

```bash
# Deploy a single app
fly deploy --config services/mental-health/fly.toml services/mental-health

# Deploy all apps
./deploy-fly.sh
```

### Deploy via GitHub Actions

Add a repository secret named `FLY_API_TOKEN` (create with `fly tokens create deploy -x 999999h`).
Pushes to `main` or `master` will automatically deploy all apps via `.github/workflows/deploy-fly.yml`.

### Internal service URL

Discord bots reference the mental-health service via HTTPS in production:

```env
MENTAL_HEALTH_URL=https://discord-mental-health-service.fly.dev
```

Each `fly.toml` sets this default. Update it if you choose a different app name.

# Agent Notes: Moderation Bot (modbot)

## What changed

- Added a `modbot/` package: message-scanning moderation bot for the
  Socialize / Visible Vapor server.
  - `src/scanner.ts` — leetspeak/diacritic normalization + offence tiers:
    CRITICAL (minor/sexual refs) -> delete + 1h timeout; HIGH (slurs,
    "gay" as insult) -> delete + warn, 2nd -> 10m timeout; MEDIUM
    (profanity + bypasses like "fonk", middle-finger emoji) -> delete +
    warn, 3rd -> 10m timeout; LOW (begging, mod disrespect) -> flag only.
  - `src/index.ts` — `messageCreate` handler. Members with
    ManageMessages/Admin are exempt. Warn counts are in-memory (reset
    on restart).
  - `.quote` analysis: invocations of `.q`/`.quote`/`!quote` are tracked
    per channel; output posted by `SOCIALIZE_BOT_ID` is re-scanned since
    AutoMod cannot filter bot messages. Flagged quote output is deleted
    and the recent invoker is held responsible.
  - `src/setup-automod.ts` — one-time `npm run setup:automod` creates
    the 8 AutoMod rules (keyword, regex, presets, mention-spam, spam).
    Idempotent: skips rules that already exist by name.
- `docker-compose.yml` — `modbot` service on discord-network, no DB deps.
- `.env.example` — MODBOT_DISCORD_TOKEN, MODBOT_GUILD_ID,
  MODBOT_LOG_CHANNEL_ID, SOCIALIZE_BOT_ID.

## Environment variables

```env
DISCORD_TOKEN=<modbot token>        # MODBOT_DISCORD_TOKEN in compose
GUILD_ID=<Visible Vapor guild id>   # only needed for setup:automod
LOG_CHANNEL_ID=<mod-log channel>
SOCIALIZE_BOT_ID=<Socialize Fun bot user id>
```

## Required Discord setup

- Enable the **Message Content** privileged intent in the dev portal.
- Bot role needs Manage Messages, Moderate Members, Send Messages
  (+ Manage Server for `setup:automod`).

## Running

```bash
cd modbot
cp .env.example .env   # fill in values
npm install && npm run build
npm run setup:automod  # one-time AutoMod rules
npm start
```

# Agent Notes: Matrix Consolidated Deployment + LLM Awareness

## What changed

- `deploy/matrix/` — single-machine Fly deployment ("matrix"):
  - `Dockerfile` — multi-stage: builds all six TS bots, then a
    node:20-bookworm-slim + python3.11 image with one shared venv for
    both inference services (CPU torch wheels).
  - `run.mjs` — process supervisor. Spawns each bot and uvicorn service,
    restarts crashes with capped exponential backoff, forwards SIGTERM,
    exposes `GET http://127.0.0.1:8090/matrix-status`.
  - `fly.toml` — `discord-matrix` app on `cpu_kind='performance',
    cpus=8, memory_mb=16384`, `matrix_data` volume at /app/data.
    Public ingress -> soundproof companion server on :3000.
  - Budget: mental-health 4c/4G, audio-events 2c/2G, soundproof 1.5G,
    discord-aibot/lastfm 768M, lkeff-listen/airhornbot/modbot 384M.

- `soundproof/src/streaming/llm-awareness.ts` — LLM machine-set registry.
  - Polls MENTAL_HEALTH_URL + AUDIO_EVENTS_URL `/health` every 30s.
  - `/health` now reports `llm.sets` (configured/healthy/latency).
  - `GET /stream/llm-status` (x-stream-token) returns the full registry
    incl. per-set cpu/mem profile and the MATRIX_CPU_CORES/MEM_MB totals.
  - State transitions (up<->down) log to console and post to
    `LLM_ALERT_CHANNEL_ID` when set.
  - `/stream/audio` fast-fails 503 while the audio-events set is down.

- Dependencies: discord.js ^14.13 -> 14.28.1 everywhere, pg 8.23.1,
  express 5.3.0. Majors left alone (anthropic sdk 1.x, ioredis 6,
  openai 7, dotenv 18, @types/node 26, typescript 7) — bump deliberately.

## Deploying the matrix

```bash
fly apps create discord-matrix
fly volumes create matrix_data --region iad --size 10 -a discord-matrix
fly secrets set DISCORD_TOKEN=... OPENAI_API_KEY=... CLAUDE_API_KEY=... \
  LASTFM_API_KEY=... LASTFM_API_SECRET=... STREAM_INGEST_TOKEN=... \
  LOG_CHANNEL_ID=... SOCIALIZE_BOT_ID=... -a discord-matrix
fly deploy --config deploy/matrix/fly.toml .
```

Databases (postgres/redis/mongo) and prometheus/grafana stay as
separate services — point DATABASE_URL/REDIS_URL/MONGO_URL at them via
secrets if bots need them.

# Agent Notes: Docker Hardening (16 GB host budget)

Applied to `docker-compose.yml`:

- Global `x-app-logging` anchor: json-file, 10 MB x 3 files per container.
- `HF_HUB_DISABLE_SYMLINKS=1` on mental-health + audio-events; HF caches
  live on named volumes (`mental_health_cache`, `audio_events_cache`).
- `tmpfs` /tmp (100M) on the python inference services.
- Healthchecks on every service; mental-health/audio-events also fail
  above ~90% of their memory limit (cgroup read) so autoheal restarts
  them before the kernel OOM-killer.
- `autoheal` service (willfarrell/autoheal) restarts any container marked
  unhealthy — Docker alone does not restart on healthcheck failure.
- mental-health adapters load with `low_cpu_mem_usage=True` (needs
  `accelerate`, added to requirements.txt).

## Host-level: sysctl (not settable per-container)

`vm.*` sysctls are host-kernel parameters — the compose `sysctls:` key
only accepts namespaced params (net.* etc). On a dedicated Linux host
for the 16 GB box, add to /etc/sysctl.d/99-discord.conf:

```conf
vm.swappiness=10          # prefer page-cache reclaim over swap
vm.dirty_ratio=15         # cap dirty page cache (% of RAM)
vm.dirty_background_ratio=5
vm.overcommit_memory=1    # python/node allocators overcommit heavily
```

then `sysctl --system`. On Docker Desktop for Windows these apply to
the WSL VM (`wsl -d docker-desktop`); on Fly.io the host is managed —
the equivalent controls are the machine size and swap volumes
(`fly machine update --swap-size` is not supported; keep RAM budgeted).
