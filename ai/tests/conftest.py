from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

os.environ.setdefault("INTERNAL_TOKEN", "test-internal-token")
os.environ.setdefault("LLM_MODEL", "claude-haiku-5-5")

SEED_DIR = Path(__file__).resolve().parents[2] / "seed"
sys.path.insert(0, str(SEED_DIR))


def _db_available() -> bool:
    try:
        import psycopg

        from signalroom_ai.config import get_settings

        with psycopg.connect(get_settings().database_url, connect_timeout=2) as conn:
            conn.execute("SELECT 1 FROM chunks LIMIT 1")
        return True
    except Exception:  # noqa: BLE001 - any failure means "no database"
        return False


@pytest.fixture(scope="session")
def db():
    if not _db_available():
        pytest.skip("Postgres (docker compose) is not reachable")
    return True


@pytest.fixture
def scratch_tenant(db):
    """A throwaway tenant, deleted (with its documents and chunks) after the test."""
    from scratch import create_tenant, delete_tenant

    created = []

    def make(name: str = "Test tenant"):
        tid = create_tenant(name, slug_prefix="pytest")
        created.append(tid)
        return tid

    yield make
    for tid in created:
        delete_tenant(tid)
