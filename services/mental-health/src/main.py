"""Mental-health inference service."""
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, Request
from prometheus_client import Counter, Histogram, generate_latest
from starlette.responses import Response

from .config import get_settings
from .models import CaseStyleClassifier, CrisisDetectionAdapter, EmbeddingAdapter, EmotionClassificationAdapter, FillMaskAdapter, NERAdapter, TriageAdapter
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CaseStyleRequest,
    CaseStyleResult,
    CrisisResult,
    EmbedRequest,
    EmotionLabel,
    EmotionResult,
    EmbeddingResult,
    Entity,
    FillMaskRequest,
    FillMaskResult,
    HealthResponse,
    NERRequest,
    NERResult,
    TriageResult,
)
from .safety import anonymize_user_id, build_crisis_safety_message, classify_severity

logger = logging.getLogger("mental-health")
logging.basicConfig(level=logging.INFO)

REQUEST_COUNT = Counter(
    "mental_health_requests_total",
    "Total requests by endpoint and task",
    ["endpoint", "task"],
)
CRISIS_DETECTED = Counter(
    "mental_health_crisis_detected_total",
    "Crisis detections by severity",
    ["severity"],
)
INFERENCE_DURATION = Histogram(
    "mental_health_inference_duration_seconds",
    "Model inference duration",
    ["model"],
)

_adapters: dict[str, Any] = {}
_catalog: dict[str, Any] = {}
_resources: dict[str, Any] = {}
_triage: TriageAdapter | None = None


def _load_catalog() -> dict[str, Any]:
    settings = get_settings()
    with open(settings.model_catalog_path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _get_adapter(name: str) -> Any:
    if name not in _adapters:
        raise HTTPException(status_code=501, detail=f"Model adapter '{name}' not configured")
    return _adapters[name]


async def _load_adapters() -> None:
    global _catalog, _resources, _triage
    settings = get_settings()
    _catalog = _load_catalog()
    _resources = settings.load_resources()
    _triage = TriageAdapter(resources=_resources, crisis_threshold=settings.crisis_threshold)

    for model_name, cfg in _catalog.items():
        if not cfg.get("enabled", False):
            logger.info("Adapter '%s' is disabled in catalog; skipping.", model_name)
            continue

        model_id = cfg["model_id"]
        kwargs = {
            "device": settings.device,
            "use_onnx": settings.use_onnx,
            "cache_dir": settings.cache_dir,
            **{k: v for k, v in cfg.items() if k not in ("task", "model_id", "enabled", "description")},
        }

        if cfg["task"] == "text-classification":
            adapter: Any = CrisisDetectionAdapter(model_id, **kwargs)
            if "emotion" in model_id.lower() or "go-emotions" in model_id.lower():
                adapter = EmotionClassificationAdapter(model_id, **kwargs)
        elif cfg["task"] == "feature-extraction":
            adapter = EmbeddingAdapter(model_id, **kwargs)
        elif cfg["task"] == "fill-mask":
            adapter = FillMaskAdapter(model_id, **kwargs)
        elif cfg["task"] == "token-classification":
            adapter = NERAdapter(model_id, **kwargs)
        else:
            logger.warning("Unknown task '%s' for model '%s'", cfg["task"], model_name)
            continue

        _adapters[model_name] = adapter
        logger.info("Loaded adapter '%s' -> %s", model_name, model_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _load_adapters()
    yield
    # Cleanup could go here.


app = FastAPI(
    title="Mental Health Inference Service",
    description="Shared classifier, emotion, and embedding service for Discord bots.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start
    logger.info("%s %s - %.3fs - %s", request.method, request.url.path, elapsed, response.status_code)
    return response


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", loaded_models=list(_adapters.keys()))


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    excerpt = text[:200] + "..." if len(text) > 200 else text

    crisis_result = None
    emotion_result = None
    triage_result = None
    embedding_result = None
    safety_message = None

    if request.include_crisis and "crisis" in _adapters:
        REQUEST_COUNT.labels(endpoint="/analyze", task="crisis").inc()
        start = time.time()
        crisis_raw = await _get_adapter("crisis").predict(text)
        INFERENCE_DURATION.labels(model="crisis").observe(time.time() - start)
        severity = classify_severity(crisis_raw["crisis_confidence"], settings.crisis_threshold)
        CRISIS_DETECTED.labels(severity=severity).inc()
        crisis_result = CrisisResult(
            label=crisis_raw["label"],
            confidence=crisis_raw["crisis_confidence"],
            severity=severity,
            is_crisis=crisis_raw["crisis_confidence"] >= settings.crisis_threshold,
        )

    if request.include_emotion and "emotion" in _adapters:
        REQUEST_COUNT.labels(endpoint="/analyze", task="emotion").inc()
        start = time.time()
        emotion_raw = await _get_adapter("emotion").predict(text, threshold=settings.emotion_threshold)
        INFERENCE_DURATION.labels(model="emotion").observe(time.time() - start)
        emotion_result = EmotionResult(
            top_emotions=[EmotionLabel(**e) for e in emotion_raw["top_emotions"][:10]],
            all_scores=emotion_raw["all_scores"],
        )

    if request.include_triage:
        REQUEST_COUNT.labels(endpoint="/analyze", task="triage").inc()
        triage_raw = await _triage.predict(crisis_result.model_dump() if crisis_result else None, emotion_result.model_dump() if emotion_result else None)
        triage_result = TriageResult(
            level=triage_raw["level"],
            urgency=triage_raw["urgency"],
            suggested_resources=triage_raw["suggested_resources"],
            reasoning=triage_raw["reasoning"],
        )
        safety_message = triage_raw.get("safety_message")

    if request.include_embedding and "embedding" in _adapters:
        REQUEST_COUNT.labels(endpoint="/analyze", task="embedding").inc()
        start = time.time()
        embed_raw = await _get_adapter("embedding").predict(text)
        INFERENCE_DURATION.labels(model="embedding").observe(time.time() - start)
        embedding_result = EmbeddingResult(**embed_raw)

    return AnalyzeResponse(
        text_excerpt=excerpt,
        crisis=crisis_result,
        emotion=emotion_result,
        triage=triage_result,
        embedding=embedding_result,
        safety_message=safety_message,
    )


@app.post("/crisis", response_model=CrisisResult)
async def crisis(request: AnalyzeRequest) -> CrisisResult:
    REQUEST_COUNT.labels(endpoint="/crisis", task="crisis").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    raw = await _get_adapter("crisis").predict(text)
    severity = classify_severity(raw["crisis_confidence"], settings.crisis_threshold)
    CRISIS_DETECTED.labels(severity=severity).inc()
    return CrisisResult(
        label=raw["label"],
        confidence=raw["crisis_confidence"],
        severity=severity,
        is_crisis=raw["crisis_confidence"] >= settings.crisis_threshold,
    )


@app.post("/emotion", response_model=EmotionResult)
async def emotion(request: AnalyzeRequest) -> EmotionResult:
    REQUEST_COUNT.labels(endpoint="/emotion", task="emotion").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    raw = await _get_adapter("emotion").predict(text, threshold=settings.emotion_threshold)
    return EmotionResult(
        top_emotions=[EmotionLabel(**e) for e in raw["top_emotions"][:10]],
        all_scores=raw["all_scores"],
    )


@app.post("/embed", response_model=EmbeddingResult)
async def embed(request: EmbedRequest) -> EmbeddingResult:
    REQUEST_COUNT.labels(endpoint="/embed", task="embedding").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    raw = await _get_adapter("embedding").predict(text)
    return EmbeddingResult(**raw)


@app.post("/bertcase/fillmask", response_model=FillMaskResult)
async def bertcase_fillmask(request: FillMaskRequest) -> FillMaskResult:
    REQUEST_COUNT.labels(endpoint="/bertcase/fillmask", task="fill-mask").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    start = time.time()
    raw = await _get_adapter("bert_case_fillmask").predict(text, top_k=request.top_k)
    INFERENCE_DURATION.labels(model="bert_case_fillmask").observe(time.time() - start)
    return FillMaskResult(**raw)


@app.post("/bertcase/ner", response_model=NERResult)
async def bertcase_ner(request: NERRequest) -> NERResult:
    REQUEST_COUNT.labels(endpoint="/bertcase/ner", task="token-classification").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    start = time.time()
    raw = await _get_adapter("bert_case_ner").predict(text)
    INFERENCE_DURATION.labels(model="bert_case_ner").observe(time.time() - start)
    return NERResult(**raw)


@app.post("/bertcase/embed", response_model=EmbeddingResult)
async def bertcase_embed(request: EmbedRequest) -> EmbeddingResult:
    REQUEST_COUNT.labels(endpoint="/bertcase/embed", task="embedding").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    start = time.time()
    raw = await _get_adapter("bert_case_embedding").predict(text)
    INFERENCE_DURATION.labels(model="bert_case_embedding").observe(time.time() - start)
    return EmbeddingResult(**raw)


@app.post("/bertcase/style", response_model=CaseStyleResult)
async def bertcase_style(request: CaseStyleRequest) -> CaseStyleResult:
    REQUEST_COUNT.labels(endpoint="/bertcase/style", task="case-style").inc()
    settings = get_settings()
    text = request.text[: settings.max_input_length]
    raw = await CaseStyleClassifier().predict(text)
    return CaseStyleResult(**raw)


@app.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(), media_type="text/plain")


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(app, host=settings.host, port=settings.port)
