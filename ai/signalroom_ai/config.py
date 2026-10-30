"""Runtime configuration, read once from the environment.

Locally the repo-root `.env` is loaded (it holds ANTHROPIC_API_KEY); in production
the platform injects the variables. Nothing secret has a default.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384


@dataclass(frozen=True)
class Settings:
    database_url: str
    internal_token: str
    anthropic_api_key: str | None
    llm_model: str
    router_model: str
    daily_llm_call_cap: int
    fastembed_cache_dir: str | None


def _forbid_opus(model: str, var: str) -> str:
    # Cost guard for the public demo: an Opus model is never allowed here.
    if "opus" in model.lower():
        raise ValueError(f"{var}={model!r} is not allowed (Opus models are disabled)")
    return model


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    load_dotenv(REPO_ROOT / ".env", override=False)
    return Settings(
        database_url=os.environ.get(
            "DATABASE_URL", "postgresql://signalroom:signalroom@localhost:5434/signalroom"
        ),
        internal_token=os.environ.get("INTERNAL_TOKEN", ""),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY") or None,
        llm_model=_forbid_opus(os.environ.get("LLM_MODEL", "claude-sonnet-5-5"), "LLM_MODEL"),
        router_model=_forbid_opus(
            os.environ.get("ROUTER_MODEL", "claude-haiku-5-5"), "ROUTER_MODEL"
        ),
        daily_llm_call_cap=int(os.environ.get("DAILY_LLM_CALL_CAP", "400")),
        fastembed_cache_dir=os.environ.get("FASTEMBED_CACHE_PATH") or None,
    )
