"""Audio event tagger built on MIT's AST model fine-tuned on AudioSet."""
import asyncio
import io
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly
from transformers import ASTFeatureExtractor, ASTForAudioClassification

TARGET_SAMPLE_RATE = 16000


def decode_audio(audio_bytes: bytes, target_rate: int = TARGET_SAMPLE_RATE, max_seconds: int = 30) -> tuple[np.ndarray, float]:
    """Decode audio bytes to a mono float32 waveform at the target sample rate.

    Returns (waveform, duration_seconds). Raises ValueError on undecodable input.
    """
    try:
        data, rate = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=True)
    except Exception as exc:
        raise ValueError(f"unsupported or corrupt audio: {exc}") from exc

    # Downmix to mono.
    waveform = data.mean(axis=1)

    if rate != target_rate:
        gcd = int(np.gcd(rate, target_rate))
        waveform = resample_poly(waveform, target_rate // gcd, rate // gcd).astype(np.float32)

    max_samples = target_rate * max_seconds
    if waveform.shape[0] > max_samples:
        waveform = waveform[:max_samples]

    duration = float(waveform.shape[0]) / target_rate
    if duration < 0.05:
        raise ValueError("audio clip too short")

    return waveform, duration


class AudioTaggerAdapter:
    """Multi-label audio event classifier (AudioSet, sigmoid head)."""

    name = "audio-tagger"

    def __init__(self, model_id: str, device: str = "cpu", cache_dir: Path | None = None) -> None:
        self.model_id = model_id
        self.device = device
        self.cache_dir = cache_dir
        self._extractor: ASTFeatureExtractor | None = None
        self._model: ASTForAudioClassification | None = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._extractor is not None

    async def load(self) -> None:
        if self.is_loaded:
            return

        loop = asyncio.get_event_loop()
        kwargs = {"cache_dir": str(self.cache_dir)} if self.cache_dir else {}

        def _load() -> tuple[Any, Any]:
            extractor = ASTFeatureExtractor.from_pretrained(self.model_id, **kwargs)
            model = ASTForAudioClassification.from_pretrained(self.model_id, **kwargs)
            model.to(self.device)
            model.eval()
            return extractor, model

        self._extractor, self._model = await loop.run_in_executor(None, _load)

    async def predict(self, audio_bytes: bytes, max_seconds: int = 30) -> dict[str, Any]:
        if not self.is_loaded:
            await self.load()

        waveform, duration = decode_audio(audio_bytes, TARGET_SAMPLE_RATE, max_seconds)
        loop = asyncio.get_event_loop()

        def _infer() -> dict[str, Any]:
            assert self._extractor is not None and self._model is not None
            inputs = self._extractor(
                waveform,
                sampling_rate=TARGET_SAMPLE_RATE,
                return_tensors="pt",
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            with torch.no_grad():
                logits = self._model(**inputs).logits
                probs = torch.sigmoid(logits)[0].cpu().tolist()

            id2label = self._model.config.id2label
            scores = {id2label[i]: float(p) for i, p in enumerate(probs)}
            ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
            return {"scores": scores, "ranked": ranked, "duration": duration}

        return await loop.run_in_executor(None, _infer)
