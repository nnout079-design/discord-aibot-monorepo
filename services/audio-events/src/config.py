"""Runtime configuration for the audio-events inference service."""
import json
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Service settings loaded from environment variables or .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "0.0.0.0"
    port: int = 8100
    log_level: str = "info"

    # Vehicle label list path; defaults to bundled config/vehicle-labels.json
    vehicle_labels_path: Path = Path(__file__).resolve().parent.parent / "config" / "vehicle-labels.json"

    # Inference settings
    model_id: str = "MIT/ast-finetuned-audioset-10-10-0.4593"
    device: str = "cpu"
    cache_dir: Path | None = None

    # Detection settings
    vehicle_threshold: float = 0.4
    max_clip_seconds: int = 30
    target_sample_rate: int = 16000
    max_audio_bytes: int = 12 * 1024 * 1024

    def load_vehicle_labels(self) -> list[str]:
        if not self.vehicle_labels_path.exists():
            return []
        with open(self.vehicle_labels_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return [str(label).lower() for label in data.get("labels", [])]


@lru_cache
def get_settings() -> Settings:
    return Settings()
