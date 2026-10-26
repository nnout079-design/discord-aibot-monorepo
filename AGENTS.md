## Stealth circuit

The `/stealth` command provides `/stealth plan` (latest server plan), `/stealth demo`, and `/stealth rules`. Authenticated `POST /stream/stealth` accepts a scene and returns the exposure plan.

```bash
curl -X POST http://localhost:3000/stream/stealth \
  -H "content-type: application/json" \
  -H "x-stream-token: $STREAM_INGEST_TOKEN" \
  -d '{"guildId":"...","channelId":"...","game":"example game","scene":{"agent":{"x":0,"y":0,"terrain":"urban"},"lights":[],"spots":[],"threats":[],"camo":{"pattern":"urban digital","coverage":0.8,"terrains":["urban"]}}}'
```

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
