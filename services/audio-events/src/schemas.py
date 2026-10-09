"""Pydantic request/response schemas for the audio-events service."""
from pydantic import BaseModel, Field


class ClassifyRequest(BaseModel):
    audio_base64: str = Field(..., min_length=8, description="Base64-encoded audio clip (WAV/FLAC/OGG).")
    threshold: float | None = Field(None, ge=0.0, le=1.0, description="Override the service vehicle threshold.")
    top_k: int = Field(10, ge=1, le=50, description="Number of top labels to return.")


class AudioDetection(BaseModel):
    label: str
    score: float
    is_vehicle: bool = False


class ClassifyResponse(BaseModel):
    model: str
    duration_seconds: float
    detections: list[AudioDetection]
    is_vehicle: bool
    top_label: str | None = None
    threshold: float


class HealthResponse(BaseModel):
    status: str
    loaded_models: list[str]
