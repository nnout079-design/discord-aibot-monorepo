# Mental Health Inference Service

Shared Python microservice that runs transformer-based mental-health models for the Discord bot monorepo.

## What it does

- **Crisis detection** — binary crisis/safe classification using `Akashpaul123/modernbert-crisis-detection` (ModernBERT-base).
- **Emotion classification** — 28-label multi-label classification using `cirimus/modernbert-large-go-emotions` (ModernBERT-large).
- **Embeddings** — sentence embeddings via `answerdotai/ModernBERT-large` or `AIMH/mental-bert-large-uncased`.
- **Triage / routing** — combines crisis and emotion scores to recommend resources and urgency.

## Quick start

```bash
cd services/mental-health
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

Test the service:

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "I feel hopeless and do not see the point anymore"}'
```

## Configuration

Copy `.env.example` to `.env` and adjust:

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `8000` | Bind port |
| `DEVICE` | `cpu` | `cpu` or `cuda` |
| `CRISIS_THRESHOLD` | `0.5` | Probability threshold for crisis flag |
| `EMOTION_THRESHOLD` | `0.5` | Threshold for returned emotion labels |
| `MODEL_CATALOG_PATH` | `config/models.yaml` | Which models to load |
| `RESOURCES_PATH` | `config/resources.json` | Crisis resource links |

## Model catalog

Edit `config/models.yaml` to enable/disable or swap models. Example:

```yaml
crisis:
  task: text-classification
  model_id: Akashpaul123/modernbert-crisis-detection
  threshold: 0.5
  enabled: true

emotion:
  task: text-classification
  model_id: cirimus/modernbert-large-go-emotions
  threshold: 0.5
  enabled: true

embedding:
  task: feature-extraction
  model_id: answerdotai/ModernBERT-large
  enabled: false
```

## Fine-tuning

```bash
python -m training.finetune \
  --model_id answerdotai/ModernBERT-large \
  --dataset_csv data/your-data.csv \
  --output_dir outputs/my-classifier \
  --num_epochs 3
```

Then export to ONNX for faster inference:

```bash
python -m training.export_onnx \
  --model_path outputs/my-classifier/model \
  --output_path outputs/my-classifier/model.onnx
```

## Safety

- This service is **not a clinical tool**. Predictions are supportive triage signals, not diagnoses.
- The configured crisis model's model card defines class index `1` as the crisis class. When model labels are generic (`LABEL_0`/`LABEL_1`), the adapter uses that documented binary-class convention; an arbitrary highest-scoring class must not be treated as crisis.
- The crisis model card reports training on synthetic data. Validate its behavior on representative, consented data and keep human review in the loop before relying on its predictions.
- Always provide human escalation paths and crisis resources.
- Review `config/resources.json` to match the regions/communities you serve.
- Do not train on user messages without informed consent and a privacy review.

## Metrics

Prometheus metrics are exposed on `/metrics`:

- `mental_health_requests_total`
- `mental_health_crisis_detected_total`
- `mental_health_inference_duration_seconds`
