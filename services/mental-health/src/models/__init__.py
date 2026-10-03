"""Model adapters for mental-health inference tasks."""
from .base import BaseModelAdapter
from .crisis import CrisisDetectionAdapter
from .emotion import EmotionClassificationAdapter
from .embeddings import EmbeddingAdapter
from .triage import TriageAdapter

__all__ = [
    "BaseModelAdapter",
    "CrisisDetectionAdapter",
    "EmotionClassificationAdapter",
    "EmbeddingAdapter",
    "TriageAdapter",
]
