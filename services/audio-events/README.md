# Audio Events Service

A FastAPI microservice that classifies short audio clips from games or Discord
voice channels and flags vehicle-related sounds (engines, horns, sirens,
aircraft, etc.). It powers the soundproof bot's vehicle-noise callbacks.

## Model

Default: [`MIT/ast-finetuned-audioset-10-10-0.4593`](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593)
— an Audio Spectrogram Transformer fine-tuned on AudioSet (527 labels,
multi-label sigmoid output).

Vehicle-related labels are configured in `config/vehicle-labels.json` as
case-insensitive substrings matched against the model's AudioSet labels.

## Endpoints

| Method | Path        | Description                                            |
| ------ | ----------- | ------------------------------------------------------ |
| GET    | `/health`   | Liveness + loaded model names                          |
| POST   | `/classify` | Top AudioSet labels for the clip                       |
| POST   | `/vehicle`  | Only vehicle detections above threshold + `is_vehicle` |
| GET    | `/metrics`  | Prometheus metrics                                     |

### Request

```json
{
  "audio_base64": "<base64 WAV/FLAC/OGG>",
  "threshold": 0.4,   // optional override
  "top_k": 10
}
```

### Response

```json
{
  "model": "MIT/ast-finetuned-audioset-10-10-0.4593",
  "duration_seconds": 4.8,
  "detections": [{ "label": "Engine", "score": 0.87, "is_vehicle": true }],
  "is_vehicle": true,
  "top_label": "Engine",
  "threshold": 0.4
}
```

## Run locally

```bash
cd services/audio-events
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8100 --reload
```

## Docker / Fly.io

Defined in the root `docker-compose.yml` as `audio-events` (port 8100). A
`fly.toml` deploys it as `discord-audio-events-service`. Bots reach it via
`AUDIO_EVENTS_URL`.
