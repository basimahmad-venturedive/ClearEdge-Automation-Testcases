"""Parse a ``testcases/TC-*.md`` file into a US-* root and a list of cases.

Kit markdown shape (see ``testcases/TC-CEIQ-FEAT-002.md``):

    **User story / epic:** US-AUTH (...free text...)
    ...
    #### TC-UAUTH-LOGIN-001 — Valid credentials route each role to its landing
    | Field | Value |
    |-------|-------|
    | **Spec reference** | ... |
    | **Module / Layer**  | UI |
    | **Priority**        | P0 |
    | **Type**            | Positive |
    | **Preconditions**   | ... |
    | **Test data**       | ... |
    | **Steps**           | 1. ... 2. ... |
    | **Expected results**| ... |

The root TestRail section name is the ``US-XXX`` token from the header. Each
case's sub-section is the TC-ID mid-segment (``tc_id.section_prefix``).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from .tc_id import section_prefix

log = logging.getLogger(__name__)

_US_ROOT_RE = re.compile(r"\*\*User story\s*/\s*epic:\*\*\s*(US-[A-Z0-9]+)", re.IGNORECASE)
# A case heading: "#### TC-... — <short title>" (any dash/em-dash separator).
_CASE_HEADING_RE = re.compile(r"^####\s+(TC-[A-Z0-9-]+)\s*(?:[—\-–]\s*(.*))?$")
# A field-table row: "| **Field** | Value |".
_FIELD_ROW_RE = re.compile(r"^\|\s*\*\*(?P<key>[^*]+?)\*\*\s*\|\s*(?P<val>.*?)\s*\|\s*$")


@dataclass
class Case:
    """One publishable manual case."""

    tc_id: str
    title: str
    section_prefix: str
    module: str = ""
    fields: dict[str, str] = field(default_factory=dict)
    custom: dict[str, object] = field(default_factory=dict)


def _extract_us_root(text: str) -> str | None:
    match = _US_ROOT_RE.search(text)
    return match.group(1).upper() if match else None


def _build_custom(fields: dict[str, str]) -> dict[str, object]:
    """Map parsed field-table rows onto TestRail custom_* fields.

    Kept deliberately simple and robust to the kit's markdown: the standard
    TestRail "Test Case (Steps)"/text template fields are populated when the
    corresponding markdown row exists.
    """
    custom: dict[str, object] = {}

    preconds_parts: list[str] = []
    if fields.get("preconditions"):
        preconds_parts.append(fields["preconditions"])
    if fields.get("test data"):
        preconds_parts.append(f"Test data: {fields['test data']}")
    meta = [
        f"{label}: {fields[key]}"
        for key, label in (
            ("priority", "Priority"),
            ("type", "Type"),
            ("spec reference", "Spec reference"),
            ("module / layer", "Module / Layer"),
        )
        if fields.get(key)
    ]
    if meta:
        preconds_parts.append(" | ".join(meta))
    if preconds_parts:
        custom["custom_preconds"] = "\n\n".join(preconds_parts)

    if fields.get("steps"):
        custom["custom_steps"] = fields["steps"]
    if fields.get("expected results"):
        custom["custom_expected"] = fields["expected results"]

    return custom


def parse_tc_markdown(path: Path | str) -> tuple[str | None, list[Case]]:
    """Return ``(us_root, cases)`` parsed from the TC markdown at ``path``."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    us_root = _extract_us_root(text)

    cases: list[Case] = []
    current: Case | None = None

    for raw in text.splitlines():
        line = raw.rstrip("\n")
        heading = _CASE_HEADING_RE.match(line.strip())
        if heading:
            tc_id = heading.group(1)
            short = (heading.group(2) or "").strip()
            title = f"{tc_id} — {short}" if short else tc_id
            current = Case(
                tc_id=tc_id,
                title=title,
                section_prefix=section_prefix(tc_id),
            )
            cases.append(current)
            continue
        if current is None:
            continue
        row = _FIELD_ROW_RE.match(line)
        if row:
            key = row.group("key").strip().lower()
            current.fields[key] = row.group("val").strip()

    for case in cases:
        case.module = case.fields.get("module / layer", "")
        case.custom = _build_custom(case.fields)

    if not cases:
        log.warning("No TC-* case headings found in %s", p)
    return us_root, cases


def is_api_case(case: Case) -> bool:
    """True when the case's Module / Layer mentions API (drives the API template)."""
    return "API" in (case.module or "").upper()


# `ToBeAutomated: Yes` / `Partial` -> automated; `No` -> not automated.
_AUTOMATED_TRUE_RE = re.compile(r"tobeautomated\s*:\s*(?:yes|partial)", re.IGNORECASE)
_AUTOMATED_FALSE_RE = re.compile(r"tobeautomated\s*:\s*no", re.IGNORECASE)


def case_type_id(case: Case, *, api_id: int, ui_id: int) -> int | None:
    """Resolve the TestRail case *type* id (Type column) for a case.

    Priority:
      1. an explicit ``| **TestRail Type** | API/UI |`` row, then
      2. the ``Module / Layer`` value (``API`` -> ``api_id``, ``UI`` -> ``ui_id``).

    Returns ``None`` when neither indicates API or UI, so the project's default
    case type is left untouched rather than guessed.
    """
    explicit = (case.fields.get("testrail type") or "").strip().upper()
    if "API" in explicit:
        return api_id
    if "UI" in explicit:
        return ui_id
    layer = (case.module or "").upper()
    if "API" in layer:
        return api_id
    if "UI" in layer:
        return ui_id
    return None


def case_is_automated(case: Case) -> bool | None:
    """Resolve the TestRail ``custom_automated`` checkbox for a case.

    Priority:
      1. an explicit ``| **Automated** | Yes/No |`` row, then
      2. the ``Automation readiness`` row (``ToBeAutomated: Yes``/``Partial``
         -> ``True``, ``No`` -> ``False``).

    Returns ``None`` when neither is present, so the case's current TestRail
    Automated value is left untouched rather than forced to a default.
    """
    explicit = (case.fields.get("automated") or "").strip().lower()
    if explicit in ("yes", "true", "1", "y"):
        return True
    if explicit in ("no", "false", "0", "n"):
        return False
    readiness = case.fields.get("automation readiness") or ""
    if _AUTOMATED_TRUE_RE.search(readiness):
        return True
    if _AUTOMATED_FALSE_RE.search(readiness):
        return False
    return None
