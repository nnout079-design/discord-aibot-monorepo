"""Crisis detection adapter using a ModernBERT classification head."""
import asyncio
from typing import Any

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from .base import BaseModelAdapter


def _crisis_class_index(id2label: dict[int, str], num_labels: int) -> int:
    """Resolve the crisis class, defaulting to class 1 for binary classifiers."""
    for index, label in id2label.items():
        if "crisis" in label.lower():
            return index

    if num_labels == 2:
        return 1

    raise ValueError("Crisis class is ambiguous for a non-binary model without a crisis label")


class CrisisDetectionAdapter(BaseModelAdapter):
    """Binary crisis / safe classifier.

    Defaults to `Akashpaul123/modernbert-crisis-detection`, a ModernBERT-base
    fine-tuned on synthetic mental-health crisis data.
    """

    name = "crisis"
    task = "text-classification"

    async def load(self) -> None:
        if self.is_loaded:
            return

        loop = asyncio.get_event_loop()
        kwargs = {"cache_dir": self.cache_dir} if self.cache_dir else {}

        def _load() -> tuple[Any, Any]:
            tokenizer = AutoTokenizer.from_pretrained(self.model_id, trust_remote_code=True, **kwargs)
            model = AutoModelForSequenceClassification.from_pretrained(
                self.model_id,
                torch_dtype="auto",
                trust_remote_code=True,
                **kwargs,
            )
            model.to(self.device)
            model.eval()
            return tokenizer, model

        self._tokenizer, self._model = await loop.run_in_executor(None, _load)

    async def predict(self, text: str) -> dict[str, Any]:
        if not self.is_loaded:
            await self.load()

        tokenizer = self._ensure_tokenizer()
        model = self._ensure_model()
        loop = asyncio.get_event_loop()

        def _infer() -> dict[str, Any]:
            inputs = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=8192,
                padding="longest",
            )
            # ModernBERT does not use token_type_ids.
            if "token_type_ids" in inputs:
                del inputs["token_type_ids"]

            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)
                probs = torch.softmax(outputs.logits, dim=-1)

            id2label = model.config.id2label
            prob_list = probs[0].cpu().tolist()
            scores = {id2label.get(i, str(i)): p for i, p in enumerate(prob_list)}

            # The configured model defines class 1 as CRISIS; LABEL_0/1 are not semantic labels.
            crisis_index = _crisis_class_index(id2label, len(prob_list))
            crisis_confidence = float(prob_list[crisis_index])

            return {
                "scores": scores,
                "crisis_confidence": crisis_confidence,
                "label": "CRISIS" if crisis_confidence > 0.5 else "SAFE",
            }

        return await loop.run_in_executor(None, _infer)
