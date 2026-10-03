"""Triage adapter that orchestrates crisis + emotion models into a recommendation."""
from typing import Any

from .. import safety
from .base import BaseModelAdapter


class TriageAdapter:
    """Lightweight orchestration layer; no separate neural network.

    Combines outputs from crisis detection and emotion classification to
    produce a triage level, urgency, and suggested resources.
    """

    name = "triage"
    task = "triage"

    def __init__(self, resources: dict[str, Any], crisis_threshold: float = 0.5) -> None:
        self.resources = resources
        self.crisis_threshold = crisis_threshold

    async def predict(
        self,
        crisis_result: dict[str, Any] | None,
        emotion_result: dict[str, Any] | None,
    ) -> dict[str, Any]:
        crisis_confidence = 0.0
        if crisis_result:
            crisis_confidence = float(
                crisis_result.get("crisis_confidence") or crisis_result.get("confidence") or 0.0
            )

        emotions: list[tuple[str, float]] = []
        if emotion_result and "all_scores" in emotion_result:
            emotions = sorted(
                emotion_result["all_scores"].items(),
                key=lambda x: x[1],
                reverse=True,
            )[:5]

        triage = safety.determine_triage(
            crisis_confidence=crisis_confidence,
            crisis_threshold=self.crisis_threshold,
            emotions=emotions,
            resources=self.resources,
        )

        safety_message = None
        if triage["level"] in ("high", "critical"):
            safety_message = safety.build_crisis_safety_message(self.resources)

        return {
            **triage,
            "crisis_confidence": crisis_confidence,
            "safety_message": safety_message,
        }
