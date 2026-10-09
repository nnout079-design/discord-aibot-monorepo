"""Named-entity recognition adapter using a cased BERT token-classification model."""
import asyncio
from typing import Any

import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

from .base import BaseModelAdapter


class NERAdapter(BaseModelAdapter):
    """Extracts named entities from text.

    Defaults to `dslim/bert-base-NER`, a BERT-base-cased model fine-tuned on
    CoNLL-2003 for PER, ORG, LOC, MISC.
    """

    name = "ner"
    task = "token-classification"

    async def load(self) -> None:
        if self.is_loaded:
            return

        loop = asyncio.get_event_loop()
        kwargs = {"cache_dir": self.cache_dir} if self.cache_dir else {}

        def _load() -> tuple[Any, Any]:
            tokenizer = AutoTokenizer.from_pretrained(self.model_id, trust_remote_code=True, **kwargs)
            model = AutoModelForTokenClassification.from_pretrained(
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

    async def predict(self, text: str, aggregation_strategy: str = "simple") -> dict[str, Any]:
        if not self.is_loaded:
            await self.load()

        tokenizer = self._ensure_tokenizer()
        model = self._ensure_model()
        loop = asyncio.get_event_loop()
        id2label = model.config.id2label

        def _infer() -> dict[str, Any]:
            inputs = tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
                padding="longest",
            )
            if "token_type_ids" in inputs:
                del inputs["token_type_ids"]

            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.no_grad():
                outputs = model(**inputs)
                logits = outputs.logits

            predictions = torch.argmax(logits, dim=-1)[0].cpu().tolist()
            tokens = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])

            entities: list[dict[str, Any]] = []
            current: dict[str, Any] | None = None
            for token, pred_id in zip(tokens, predictions):
                label = id2label.get(pred_id, "O")
                if token in (tokenizer.cls_token, tokenizer.sep_token, tokenizer.pad_token):
                    continue

                # Convert WordPiece token back to a readable word fragment.
                word = token.replace("##", "")

                if label.startswith("B-"):
                    if current is not None:
                        entities.append(current)
                    current = {"word": word, "label": label[2:], "score": 1.0}
                elif label.startswith("I-") and current is not None and label[2:] == current["label"]:
                    current["word"] += word
                else:
                    if current is not None:
                        entities.append(current)
                        current = None

            if current is not None:
                entities.append(current)

            return {
                "model": self.model_id,
                "entities": entities,
            }

        return await loop.run_in_executor(None, _infer)
