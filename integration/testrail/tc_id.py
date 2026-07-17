"""TC-ID helpers and ``testcases/testrail_map.json`` load/save.

The map is a FLAT object ``{ "TC-ID": <int case id> }`` shared with the rest of
the kit (148+ FEAT-001 entries already present). Saving MERGES — it never drops
an existing key — so publishing a new feature is additive and idempotent.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

# automation/integration/testrail/tc_id.py -> repo root is parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
TESTRAIL_MAP_PATH = REPO_ROOT / "testcases" / "testrail_map.json"

# A TC-ID: TC- followed by dash-separated alphanumeric segments (TC-UAUTH-LOGIN-001).
_TC_ID_RE = re.compile(r"TC-[A-Z0-9]+(?:-[A-Z0-9]+)*")
# mid-segment = everything between "TC-" and the trailing "-<digits>".
_SECTION_PREFIX_RE = re.compile(r"^TC-(?P<prefix>.+)-\d+$")


def extract_tc_id_from_text(text: str) -> str | None:
    """Return the first TC-ID found in ``text`` (or ``None``)."""
    if not text:
        return None
    match = _TC_ID_RE.search(text)
    return match.group(0) if match else None


def section_prefix(tc_id: str) -> str:
    """Return the sub-section name for ``tc_id`` (the mid-segment).

    ``TC-ADMAPI-001`` -> ``ADMAPI``; ``TC-UAUTH-API-001`` -> ``UAUTH-API``;
    ``TC-UAUTH-SEC-003`` -> ``UAUTH-SEC``.
    """
    match = _SECTION_PREFIX_RE.match(tc_id)
    if match:
        return match.group("prefix")
    # Fallback: strip a leading TC- if the trailing -<digits> is absent.
    return tc_id[3:] if tc_id.startswith("TC-") else tc_id


def load_testrail_map(path: Path | str = TESTRAIL_MAP_PATH) -> dict[str, int]:
    """Load the flat TC-ID -> case-id map; return ``{}`` if the file is absent."""
    p = Path(path)
    if not p.is_file():
        log.warning("testrail_map.json not found at %s; starting empty", p)
        return {}
    with p.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{p} is not a flat object of TC-ID -> case id")
    return {str(k): int(v) for k, v in data.items()}


def save_testrail_map(
    mapping: dict[str, int], path: Path | str = TESTRAIL_MAP_PATH
) -> None:
    """MERGE ``mapping`` into the on-disk map and write it back (flat object).

    Existing keys keep their position and value; new keys are appended in
    insertion order. Nothing is ever dropped.
    """
    p = Path(path)
    merged = load_testrail_map(p)
    for k, v in mapping.items():
        merged[str(k)] = int(v)
    with p.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(merged, fh, indent=2)
        fh.write("\n")
    log.debug("Wrote %d entries to %s", len(merged), p)
