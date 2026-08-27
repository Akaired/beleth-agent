"""Runtime configuration.

Two separate concerns live here, deliberately kept apart:

- `Settings`: secrets and per-environment values, loaded from `.env` / the environment.
  Fails fast with a clear error at startup if something required is missing or wrong
  (see `get_settings`).
- `load_strategy_config`: the strategy's trading parameters, loaded from
  `config/strategy.yaml`. These are not secrets — they're tunable knobs that must never
  be hardcoded in the strategy/risk logic itself.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent
STRATEGY_CONFIG_PATH = REPO_ROOT / "config" / "strategy.yaml"

PAPER_BASE_URL = "https://paper-api.alpaca.markets"


class Settings(BaseSettings):
    """Secrets and environment configuration, loaded from `.env`."""

    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    alpaca_api_key: str
    alpaca_secret_key: str
    alpaca_base_url: str = PAPER_BASE_URL

    regolo_key: str
    regolo_base_url: str = "https://api.regolo.ai/v1"
    regolo_model: str = "Llama-3.3-70B-Instruct"

    @field_validator("alpaca_base_url")
    @classmethod
    def _must_be_paper_endpoint(cls, v: str) -> str:
        if v.rstrip("/") != PAPER_BASE_URL:
            raise ValueError(
                f"ALPACA_BASE_URL must be exactly {PAPER_BASE_URL!r} (paper trading). "
                "This project never trades live — see the hard constraint #1."
            )
        return v


class ConfigError(RuntimeError):
    """Raised at startup when required configuration is missing or invalid."""


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        missing = [
            str(err["loc"][0])
            for err in exc.errors()
            if err["type"] == "missing"
        ]
        other = [err for err in exc.errors() if err["type"] != "missing"]
        lines = ["Configuration error — cannot start.", ""]
        if missing:
            env_names = [name.upper() for name in missing]
            lines.append(f"Missing required environment variable(s): {', '.join(env_names)}")
            lines.append("Copy .env.example to .env and fill them in.")
        for err in other:
            lines.append(f"{err['loc'][0]}: {err['msg']}")
        raise ConfigError("\n".join(lines)) from exc


def load_strategy_config() -> dict[str, Any]:
    with STRATEGY_CONFIG_PATH.open() as f:
        return yaml.safe_load(f)
