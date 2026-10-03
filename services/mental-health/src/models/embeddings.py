"""Embedding adapter using ModernBERT or MentalBERT."""
import asyncio
from typing import Any

import torch
from transformers import AutoModel, AutoTokenizer

from .base import BaseModelAdapter


class EmbeddingAdapter(BaseModelAdapter):
    """Produces pooled sentence embeddings from an encoder model.

    Defaults to `answerdotai/ModernBERT-large`. MentalBERT can be substituted
    via the model catalog for mental-health-specific representations.
    """

    name = "embedding"
    task = "feature-extraction"

    async def load(self) -> None:
        if self.is_loaded:
            return

        loop = asyncio.get_event_loop()
        kwargs = {"cache_dir": self.cache_dir} if self.cache_dir else {}

        def _load() -> tuple[Any, Any]:
            tokenizer = AutoTokenizer.from_pretrained(self.model_id, trust_remote_code=True, **kwargs)
            model = AutoModel.from_pretrained(
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
            if "token_type_ids" in inputs:
                del inputs["token_type_ids"]

            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)

            # Mean pooling over the final hidden states, ignoring padding.
            token_embeddings = outputs.last_hidden_state
            attention_mask = inputs["attention_mask"]
            mask_expanded = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
            sum_embeddings = torch.sum(token_embeddings * mask_expanded, dim=1)
            sum_mask = torch.clamp(mask_expanded.sum(dim=1), min=1e-9)
            pooled = sum_embeddings / sum_mask

            vector = pooled[0].cpu().tolist()
            return {
                "model": self.model_id,
                "dimensions": len(vector),
                "vector": vector,
            }

        return await loop.run_in_executor(None, _infer)
