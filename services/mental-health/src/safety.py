"""Safety policy engine: thresholds, resource matching, and disclaimers."""
from typing import Any


CRISIS_SEVERITY_LEVELS = ["low", "moderate", "high", "critical"]
TRIAGE_LEVELS = ["none", "low", "moderate", "high", "critical"]
URGENCY_MAP = {
    "none": "routine",
    "low": "routine",
    "moderate": "support",
    "high": "urgent",
    "critical": "emergency",
}


def classify_severity(confidence: float, threshold: float = 0.5) -> str:
    """Map a crisis probability to a human-readable severity bucket."""
    if confidence < threshold:
        return "low"
    if confidence < 0.75:
        return "moderate"
    if confidence < 0.9:
        return "high"
    return "critical"


def determine_triage(
    crisis_confidence: float,
    crisis_threshold: float,
    emotions: list[tuple[str, float]],
    resources: dict[str, Any],
) -> dict[str, Any]:
    """Combine model outputs into a triage decision and suggested resources."""
    severity = classify_severity(crisis_confidence, crisis_threshold)

    if severity == "critical":
        level = "critical"
    elif severity == "high":
        level = "high"
    elif severity == "moderate":
        level = "moderate"
    else:
        distress_labels = {"sadness", "fear", "disappointment", "grief", "nervousness"}
        distress_score = sum(score for label, score in emotions if label in distress_labels)
        level = "moderate" if distress_score > 0.5 else "low"
        if crisis_confidence < 0.1 and distress_score < 0.2:
            level = "none"

    urgency = URGENCY_MAP[level]
    resource_list = resources.get(level, resources.get("general", []))

    reasoning_parts = [f"Crisis confidence {crisis_confidence:.2f} -> severity '{severity}'."]
    if emotions:
        top = max(emotions, key=lambda x: x[1])
        reasoning_parts.append(f"Top detected emotion: {top[0]} ({top[1]:.2f}).")
    reasoning_parts.append(f"Triage level '{level}' mapped to urgency '{urgency}'.")

    return {
        "level": level,
        "urgency": urgency,
        "suggested_resources": resource_list,
        "reasoning": " ".join(reasoning_parts),
    }


def build_crisis_safety_message(resources: dict[str, Any]) -> str:
    """Return a compassionate crisis safety message with resources."""
    lines = [
        "It sounds like you may be going through a really difficult time right now.",
        "I'm not a mental health professional, but I want to make sure you have support.",
    ]
    emergency = resources.get("critical") or resources.get("general") or []
    if emergency:
        lines.append("Here are some resources that can help right now:")
        lines.extend(f"- {r}" for r in emergency)
    lines.append(
        "If you or someone you know is in immediate danger, please contact local emergency services."
    )
    return "\n".join(lines)


def anonymize_user_id(user_id: str | int | None) -> str | None:
    """One-way hash a Discord user ID for logging while still allowing uniqueness checks."""
    import hashlib

    if user_id is None:
        return None
    value = str(user_id).encode("utf-8")
    return hashlib.sha256(value).hexdigest()[:16]
