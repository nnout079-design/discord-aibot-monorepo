"""Base class for model adapters."""
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any


class BaseModelAdapter(ABC):
    """Abstract base for a model adapter.

    Each adapter knows how to load a Hugging Face model (PyTorch or ONNX) and
    run inference for a specific mental-health task.
    """

    name: str = "base"
    task: str = "unknown"

    def __init__(self, model_id: str, device: str = "cpu", use_onnx: bool = False, cache_dir: Path | None = None, **kwargs: Any) -> None:
        self.model_id = model_id
        self.device = device
        self.use_onnx = use_onnx
        self.cache_dir = cache_dir
        self._model = None
        self._tokenizer = None
        self._labels = kwargs.get("labels") or kwargs.get("id2label", {})
        self.extra = kwargs

    @property
    def is_loaded(self) -> bool:
        return self._model is not None and self._tokenizer is not None

    @abstractmethod
    async def load(self) -> None:
        """Load tokenizer and model into memory."""
        raise NotImplementedError

    @abstractmethod
    async def predict(self, text: str) -> dict[str, Any]:
        """Run inference and return a structured result dict."""
        raise NotImplementedError

    def _ensure_tokenizer(self) -> Any:
        if self._tokenizer is None:
            raise RuntimeError(f"Tokenizer not loaded for {self.name}")
        return self._tokenizer

    def _ensure_model(self) -> Any:
        if self._model is None:
            raise RuntimeError(f"Model not loaded for {self.name}")
        return self._model
