"""TESTRAIL_* environment accessors for the manual-case publisher.

Secrets policy (`.claude/rules/secrets-and-env.rules.md`): the TestRail URL,
credentials, and project/suite ids are read only from a local ``.env`` — never
hardcoded here. The loader searches, in order:

    1. automation/integration/testrail/.env   (module-local)
    2. <repo-root>/.env                        (last resort)

On a LIVE publish, a missing required variable raises ``MissingSettingError``
naming both the variable and the ``.env`` file to populate. ``--dry-run`` never
touches these accessors, so an unconfigured checkout can still be verified.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

try:  # python-dotenv is a declared dependency (requirements.txt)
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - dotenv missing is a setup error
    load_dotenv = None  # type: ignore[assignment]

log = logging.getLogger(__name__)

# automation/integration/testrail/testrail_settings.py -> repo root is parents[3]
_THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = _THIS_DIR.parents[2]

# Search order for the .env file.
ENV_CANDIDATES = (
    _THIS_DIR / ".env",
    REPO_ROOT / ".env",
)

# The .env file the error messages point users at.
PRIMARY_ENV_PATH = ENV_CANDIDATES[0]

_LOADED = False


class MissingSettingError(RuntimeError):
    """Raised on a live publish when a required TESTRAIL_* variable is absent."""


def load_env() -> None:
    """Load the first ``.env`` found in :data:`ENV_CANDIDATES` (idempotent)."""
    global _LOADED
    if _LOADED:
        return
    if load_dotenv is None:  # pragma: no cover
        log.warning("python-dotenv not installed; relying on process environment only")
        _LOADED = True
        return
    for candidate in ENV_CANDIDATES:
        if candidate.is_file():
            load_dotenv(dotenv_path=candidate, override=False)
            log.debug("Loaded TestRail settings from %s", candidate)
    _LOADED = True


def _get(name: str) -> str | None:
    load_env()
    value = os.environ.get(name)
    if value is not None:
        value = value.strip()
    return value or None


def _require(name: str) -> str:
    value = _get(name)
    if not value:
        raise MissingSettingError(
            f"Required TestRail setting {name!r} is not set. "
            f"Add it to {PRIMARY_ENV_PATH} (copy from .env.example)."
        )
    return value


# --- Optional accessors (return None when unset) ---------------------------

def testrail_url() -> str | None:
    return _get("TESTRAIL_URL")


def testrail_username() -> str | None:
    return _get("TESTRAIL_USERNAME")


def testrail_password() -> str | None:
    return _get("TESTRAIL_PASSWORD")


def testrail_project_id() -> int | None:
    raw = _get("TESTRAIL_PROJECT_ID")
    return int(raw) if raw else None


def testrail_suite_id() -> int | None:
    raw = _get("TESTRAIL_SUITE_ID")
    return int(raw) if raw else None


def testrail_api_template_id() -> int | None:
    """template_id applied to API cases; None means "use the project default"."""
    raw = _get("TESTRAIL_API_TEMPLATE_ID")
    return int(raw) if raw else None


# --- Required accessors (raise on a live publish) --------------------------

def require_url() -> str:
    return _require("TESTRAIL_URL")


def require_username() -> str:
    return _require("TESTRAIL_USERNAME")


def require_password() -> str:
    return _require("TESTRAIL_PASSWORD")


def require_project_id() -> int:
    return int(_require("TESTRAIL_PROJECT_ID"))


def require_suite_id() -> int:
    return int(_require("TESTRAIL_SUITE_ID"))
