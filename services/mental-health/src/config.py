"""Runtime configuration for the mental-health inference service."""
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"

    # Model catalog path; defaults to bundled config/models.yaml
    model_catalog_path: Path = Path(__file__).resolve().parent.parent / "config" / "models.yaml"

    # Crisis resources path; defaults to bundled config/resources.json
    resources_path: Path = Path(__file__).resolve().parent.parent / "config" / "resources.json"

    # Global inference settings
    device: str = "cpu"
    use_onnx: bool = False
    cache_dir: Path | None = None

    # Default thresholds
    crisis_threshold: float = 0.5
    emotion_threshold: float = 0.5

    # Safety / privacy
    anonymize_user_ids: bool = True
    max_input_length: int = 4000

    def load_resources(self) -> dict[str, Any]:
        if not self.resources_path.exists():
            return {}
        with open(self.resources_path, "r", encoding="utf-8") as fh:
            return json.load(fh)


@lru_cache
def get_settings() -> Settings:
    return Settings()
