"""TC-ID extraction and testrail_map.json load/save helpers."""
from __future__ import annotations

import json
import pathlib
import re

_TC_ID_RE = re.compile(r"\bTC-[A-Z]+-\d+\b")


def extract_tc_id_from_text(text: str) -> list[str]:
    """Returns every distinct TC-ID mentioned in text, in first-seen order."""
    seen: list[str] = []
    for match in _TC_ID_RE.findall(text):
        if match not in seen:
            seen.append(match)
    return seen


def load_testrail_map(path: str | pathlib.Path) -> dict[str, int]:
    p = pathlib.Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def save_testrail_map(path: str | pathlib.Path, mapping: dict[str, int]) -> None:
    p = pathlib.Path(path)
    p.write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n", encoding="utf-8")
