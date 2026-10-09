"""Fill-mask adapter using a cased BERT masked language model."""
import asyncio
from typing import Any

import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

from .base import BaseModelAdapter


class FillMaskAdapter(BaseModelAdapter):
    """Predicts masked tokens in a sentence.

    Defaults to `google-bert/bert-base-cased` so that predictions are case
    sensitive (e.g., `Paris` vs `paris`).
    """

    name = "fill_mask"
    task = "fill-mask"

    async def load(self) -> None:
        if self.is_loaded:
            return

        loop = asyncio.get_event_loop()
        kwargs = {"cache_dir": self.cache_dir} if self.cache_dir else {}

        def _load() -> tuple[Any, Any]:
            tokenizer = AutoTokenizer.from_pretrained(self.model_id, trust_remote_code=True, **kwargs)
            model = AutoModelForMaskedLM.from_pretrained(
                self.model_id,
                torch_dtype=torch.float32,
                trust_remote_code=True,
                low_cpu_mem_usage=False,
                **kwargs,
            )
            model.to(self.device)
            model.eval()
            return tokenizer, model

        self._tokenizer, self._model = await loop.run_in_executor(None, _load)

    async def predict(self, text: str, top_k: int = 5) -> dict[str, Any]:
        if not self.is_loaded:
            await self.load()

        tokenizer = self._ensure_tokenizer()
        model = self._ensure_model()
        loop = asyncio.get_event_loop()

        def _infer() -> dict[str, Any]:
            if tokenizer.mask_token is None:
                raise RuntimeError(f"Tokenizer for {self.model_id} has no mask token")

            inputs = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding="longest",
            )
            if tokenizer.mask_token_id not in inputs["input_ids"]:
                raise ValueError(f"Input must contain the mask token '{tokenizer.mask_token}'")

            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)
                logits = outputs.logits

            mask_token_index = (inputs["input_ids"] == tokenizer.mask_token_id).nonzero(as_tuple=True)
            mask_logits = logits[mask_token_index[0], mask_token_index[1], :]
            probs = torch.softmax(mask_logits, dim=-1)
            top_probs, top_indices = torch.topk(probs, k=min(top_k, probs.size(-1)), dim=-1)

            predictions = [
                {
                    "token": tokenizer.convert_ids_to_tokens(int(idx)),
                    "word": tokenizer.convert_ids_to_tokens(int(idx)).replace("##", ""),
                    "score": float(score),
                }
                for idx, score in zip(top_indices[0].tolist(), top_probs[0].tolist())
            ]

            return {
                "model": self.model_id,
                "predictions": predictions,
            }

        return await loop.run_in_executor(None, _infer)
