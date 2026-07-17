"""Five-Lens coverage-review publish gate.

Before a LIVE publish, the feature's Manual TC Coverage Review must explicitly
allow it with a line matching ``TestRail publish allowed | Yes`` (pipe/space
variance tolerated). ``--dry-run`` warns but proceeds; ``--skip-coverage-review``
bypasses with a loud warning.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[3]
REVIEW_DIR = REPO_ROOT / "documents" / "output" / "Manual TC Coverage Review"

# "TestRail publish allowed | Yes" — allow arbitrary spaces and pipe variance.
_ALLOWED_RE = re.compile(r"TestRail\s+publish\s+allowed\s*\|+\s*Yes", re.IGNORECASE)


def feature_slug(tc_file: Path | str) -> str:
    """``testcases/TC-CEIQ-FEAT-002.md`` -> ``CEIQ-FEAT-002``."""
    stem = Path(tc_file).stem  # TC-CEIQ-FEAT-002
    return stem[3:] if stem.startswith("TC-") else stem


def review_path(slug: str) -> Path:
    return REVIEW_DIR / f"REVIEW_{slug}_FIVE_LENS.md"


def is_publish_allowed(slug: str) -> tuple[bool, Path]:
    """Return ``(allowed, review_file_path)`` for the feature ``slug``."""
    path = review_path(slug)
    if not path.is_file():
        return False, path
    text = path.read_text(encoding="utf-8")
    return bool(_ALLOWED_RE.search(text)), path


def check_gate(slug: str, *, dry_run: bool, skip: bool) -> bool:
    """Evaluate the gate. Return True to proceed, False to block a live publish.

    - ``skip`` -> proceed with a loud warning (never for routine use).
    - allowed -> log "Coverage gate satisfied for <slug> (<path>)" and proceed.
    - not allowed + ``dry_run`` -> warn, proceed (dry run makes no writes).
    - not allowed + live -> block (return False).
    """
    if skip:
        log.warning(
            "!!! Coverage review BYPASSED for %s via --skip-coverage-review "
            "(emergency only) !!!",
            slug,
        )
        return True

    allowed, path = is_publish_allowed(slug)
    if allowed:
        log.info("Coverage gate satisfied for %s (%s)", slug, path)
        return True

    if not path.is_file():
        reason = f"coverage review not found: {path}"
    else:
        reason = f"'TestRail publish allowed | Yes' not found in {path}"

    if dry_run:
        log.warning("[DRY RUN] Coverage gate NOT satisfied for %s — %s", slug, reason)
        return True

    log.error("Coverage gate BLOCKS live publish for %s — %s", slug, reason)
    return False
