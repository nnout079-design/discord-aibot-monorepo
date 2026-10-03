"""Emotion classification adapter using a ModernBERT multi-label head."""
import asyncio
from typing import Any

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from .base import BaseModelAdapter


class EmotionClassificationAdapter(BaseModelAdapter):
    """Multi-label emotion classifier.

    Defaults to `cirimus/modernbert-large-go-emotions`, fine-tuned on the
    GoEmotions dataset (28 labels). Each input can trigger multiple labels.
    """

    name = "emotion"
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

    async def predict(self, text: str, threshold: float = 0.5) -> dict[str, Any]:
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
            if "token_type_ids" in inputs:
                del inputs["token_type_ids"]

            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)
                # Multi-label emotion models usually use sigmoid.
                probs = torch.sigmoid(outputs.logits)

            id2label = model.config.id2label
            prob_list = probs[0].cpu().tolist()
            all_scores = {id2label.get(i, str(i)): float(p) for i, p in enumerate(prob_list)}

            top = sorted(all_scores.items(), key=lambda x: x[1], reverse=True)
            above_threshold = [
                {"label": label, "score": score} for label, score in top if score >= threshold
            ]

            return {
                "top_emotions": [
                    {"label": label, "score": score} for label, score in top
                ],
                "above_threshold": above_threshold,
                "all_scores": all_scores,
            }

        return await loop.run_in_executor(None, _infer)
