"""Rule-based case-style classifier for Discord text."""
import re
from typing import Any


class CaseStyleClassifier:
    """Detects common text casing styles without a transformer model.

    Styles: lowercase, UPPERCASE, Title Case, Mixed, sponge-case (aLtErNaTiNg).
    """

    name = "case_style"
    task = "case-style"

    async def predict(self, text: str) -> dict[str, Any]:
        letters = re.sub(r"[^a-zA-Z]", "", text)
        if not letters:
            return {"style": "none", "letters": 0, "confidence": 1.0}

        lower_count = sum(1 for c in letters if c.islower())
        upper_count = len(letters) - lower_count

        if letters.islower():
            style = "lowercase"
        elif letters.isupper():
            style = "uppercase"
        elif all(
            word[0].isupper() and word[1:].islower()
            for word in re.split(r"[^a-zA-Z]+", text)
            if len(word) > 0
        ):
            style = "title-case"
        else:
            # Heuristic for alternating case (sponge/mock-case).
            alternating_count = 0
            for i, c in enumerate(letters):
                expected_lower = i % 2 == 0
                if (expected_lower and c.islower()) or (not expected_lower and c.isupper()):
                    alternating_count += 1
            alternating_score = alternating_count / len(letters)
            if alternating_score > 0.75:
                style = "sponge-case"
            else:
                style = "mixed"

        return {
            "style": style,
            "letters": len(letters),
            "uppercase": upper_count,
            "lowercase": lower_count,
            "confidence": 1.0,
        }
