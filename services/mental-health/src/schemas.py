"""Pydantic request/response schemas shared across the service."""
from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000, description="Input text to analyze.")
    include_crisis: bool = Field(True, description="Run crisis detection.")
    include_emotion: bool = Field(True, description="Run emotion classification.")
    include_triage: bool = Field(True, description="Run triage / routing.")
    include_embedding: bool = Field(False, description="Return text embedding.")


class CrisisResult(BaseModel):
    label: str
    confidence: float
    severity: str
    is_crisis: bool


class EmotionLabel(BaseModel):
    label: str
    score: float


class EmotionResult(BaseModel):
    top_emotions: list[EmotionLabel]
    all_scores: dict[str, float] | None = None


class TriageResult(BaseModel):
    level: str
    urgency: str
    suggested_resources: list[str]
    reasoning: str


class EmbeddingResult(BaseModel):
    model: str
    dimensions: int
    vector: list[float] | None = None


class AnalyzeResponse(BaseModel):
    text_excerpt: str
    crisis: CrisisResult | None = None
    emotion: EmotionResult | None = None
    triage: TriageResult | None = None
    embedding: EmbeddingResult | None = None
    safety_message: str | None = None
    disclaimer: str = (
        "This analysis is for informational and supportive purposes only. "
        "It is not a clinical diagnosis. If you or someone you know is in crisis, "
        "please contact emergency services or a mental health professional."
    )


class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)


class HealthResponse(BaseModel):
    status: str
    loaded_models: list[str]
