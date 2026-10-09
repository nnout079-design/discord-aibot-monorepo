"""Model adapters for mental-health inference tasks."""
from .base import BaseModelAdapter
from .case_style import CaseStyleClassifier
from .crisis import CrisisDetectionAdapter
from .emotion import EmotionClassificationAdapter
from .embeddings import EmbeddingAdapter
from .fill_mask import FillMaskAdapter
from .ner import NERAdapter
from .triage import TriageAdapter

__all__ = [
    "BaseModelAdapter",
    "CaseStyleClassifier",
    "CrisisDetectionAdapter",
    "EmotionClassificationAdapter",
    "EmbeddingAdapter",
    "FillMaskAdapter",
    "NERAdapter",
    "TriageAdapter",
]
