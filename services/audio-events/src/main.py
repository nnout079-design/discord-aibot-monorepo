"""Audio-events inference service: classifies game/voice audio and flags vehicle noise."""
import base64
import binascii
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from prometheus_client import Counter, Histogram, generate_latest
from starlette.responses import Response

from .config import get_settings
from .models import AudioTaggerAdapter
from .schemas import AudioDetection, ClassifyRequest, ClassifyResponse, HealthResponse

logger = logging.getLogger("audio-events")
logging.basicConfig(level=logging.INFO)

REQUEST_COUNT = Counter(
    "audio_events_requests_total",
    "Total requests by endpoint",
    ["endpoint"],
)
VEHICLE_DETECTED = Counter(
    "audio_events_vehicle_detected_total",
    "Vehicle detections by top label",
    ["label"],
)
INFERENCE_DURATION = Histogram(
    "audio_events_inference_duration_seconds",
    "Model inference duration",
    ["model"],
)

_tagger: AudioTaggerAdapter | None = None
_vehicle_labels: list[str] = []


def _is_vehicle_label(label: str) -> bool:
    lowered = label.lower()
    return any(fragment in lowered for fragment in _vehicle_labels)


def _to_response(raw: dict, threshold: float, top_k: int, vehicle_only: bool) -> ClassifyResponse:
    detections = [
        AudioDetection(label=label, score=score, is_vehicle=_is_vehicle_label(label))
        for label, score in raw["ranked"][:top_k]
    ]
    vehicle_hits = [d for d in detections if d.is_vehicle and d.score >= threshold]
    return ClassifyResponse(
        model=_tagger.model_id if _tagger else "unknown",
        duration_seconds=raw["duration"],
        detections=vehicle_hits if vehicle_only else detections,
        is_vehicle=bool(vehicle_hits),
        top_label=vehicle_hits[0].label if vehicle_hits else (detections[0].label if detections else None),
        threshold=threshold,
    )


def _decode_payload(request: ClassifyRequest) -> bytes:
    settings = get_settings()
    try:
        audio = base64.b64decode(request.audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="audio_base64 is not valid base64") from exc
    if len(audio) > settings.max_audio_bytes:
        raise HTTPException(status_code=413, detail="audio clip exceeds maximum size")
    return audio


async def _run(request: ClassifyRequest, endpoint: str, vehicle_only: bool) -> ClassifyResponse:
    settings = get_settings()
    assert _tagger is not None
    REQUEST_COUNT.labels(endpoint=endpoint).inc()

    audio = _decode_payload(request)
    threshold = request.threshold if request.threshold is not None else settings.vehicle_threshold

    try:
        start = time.time()
        raw = await _tagger.predict(audio, max_seconds=settings.max_clip_seconds)
        INFERENCE_DURATION.labels(model="audio-tagger").observe(time.time() - start)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = _to_response(raw, threshold, request.top_k, vehicle_only)
    if result.is_vehicle and result.top_label:
        VEHICLE_DETECTED.labels(label=result.top_label).inc()
    return result


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tagger, _vehicle_labels
    settings = get_settings()
    _vehicle_labels = settings.load_vehicle_labels()
    _tagger = AudioTaggerAdapter(settings.model_id, device=settings.device, cache_dir=settings.cache_dir)
    await _tagger.load()
    logger.info("Loaded audio tagger '%s' with %d vehicle label fragments", settings.model_id, len(_vehicle_labels))
    yield


app = FastAPI(
    title="Audio Events Inference Service",
    description="Shared audio-tagging service that flags vehicle noise in game/voice audio for Discord bots.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def log_requests(request, call_next):
    start = time.time()
    response = await call_next(request)
    logger.info("%s %s - %.3fs - %s", request.method, request.url.path, time.time() - start, response.status_code)
    return response


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", loaded_models=[_tagger.name] if _tagger and _tagger.is_loaded else [])


@app.post("/classify", response_model=ClassifyResponse)
async def classify(request: ClassifyRequest) -> ClassifyResponse:
    """Return the top AudioSet labels for the clip."""
    return await _run(request, "/classify", vehicle_only=False)


@app.post("/vehicle", response_model=ClassifyResponse)
async def vehicle(request: ClassifyRequest) -> ClassifyResponse:
    """Return only vehicle-related detections above the threshold."""
    return await _run(request, "/vehicle", vehicle_only=True)


@app.get("/metrics")
async def metrics() -> Response:
    return Response(content=generate_latest(), media_type="text/plain")


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(app, host=settings.host, port=settings.port)
