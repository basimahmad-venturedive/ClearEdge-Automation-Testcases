"""Blocks live publish unless the Five-Lens coverage review approves it."""
from __future__ import annotations

import pathlib
import re


class CoverageGateNotSatisfied(RuntimeError):
    pass


def find_review_path(feature_slug: str) -> pathlib.Path:
    return pathlib.Path("documents/output/Manual TC Coverage Review") / f"REVIEW_{feature_slug}_FIVE_LENS.md"


def check_publish_allowed(feature_slug: str, *, skip_gate: bool = False) -> None:
    if skip_gate:
        return
    review_path = find_review_path(feature_slug)
    if not review_path.exists():
        raise CoverageGateNotSatisfied(
            f"No Five-Lens coverage review found at {review_path}. Run manual-testcase-coverage-review first, "
            "or pass --skip-coverage-review for an emergency override."
        )
    text = review_path.read_text(encoding="utf-8")
    if not re.search(r"TestRail publish allowed \|\s*Yes", text):
        raise CoverageGateNotSatisfied(
            f"{review_path} does not state 'TestRail publish allowed | Yes'. "
            "Resolve the coverage gate before publishing, or pass --skip-coverage-review."
        )
