"""Step E — publish manual test cases from a TC-*.md file to TestRail.

Usage (offline plan; zero network, zero writes)::

    python automation/integration/testrail/publish_manual_cases.py \
        --file testcases/TC-CEIQ-FEAT-002.md --dry-run

Live publish (requires TESTRAIL_* in .env and a green Five-Lens gate)::

    python automation/integration/testrail/publish_manual_cases.py \
        --file testcases/TC-CEIQ-FEAT-002.md

Orchestration per file:
    coverage gate -> parse -> get/create US-* root + prefix sub-sections ->
    for each case not already in testrail_map.json: add_case -> write back
    (testrail_map.json, the TC markdown's TestRail ID row, TRACEABILITY.md).

Contracts honoured (never break FEAT-001 data):
    * testrail_map.json stays a flat {TC-ID: int} object; entries are MERGED,
      already-present TC-IDs are skipped (idempotent).
    * The US-* token from the header is the single root section (reused).
    * Each case groups under US-* > <mid-segment prefix>.
    * --dry-run makes ZERO network calls and ZERO write-backs.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from collections import OrderedDict
from pathlib import Path

# Allow running as a plain script (`python .../publish_manual_cases.py`) as well
# as a module (`python -m integration.testrail.publish_manual_cases`). When run
# as a script there is no parent package, so bootstrap one before the relative
# imports below (PEP 366).
if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    __package__ = "integration.testrail"

from . import coverage_review_gate as gate
from . import testrail_settings as settings
from .client import TestRailClient
from .parse_tc_markdown import (
    Case,
    case_is_automated,
    case_type_id,
    is_api_case,
    parse_tc_markdown,
)
from .tc_id import REPO_ROOT, load_testrail_map, save_testrail_map

log = logging.getLogger("publish_manual_cases")

TRACEABILITY_PATH = REPO_ROOT / "testcases" / "TRACEABILITY.md"


# --------------------------------------------------------------------------- #
# Write-backs (LIVE publish only)
# --------------------------------------------------------------------------- #

def _testrail_row(case_id: int) -> str:
    return f"| **TestRail ID** | C{case_id} |"


def update_markdown_testrail_id(tc_file: Path, tc_id: str, case_id: int) -> bool:
    """Insert/update the ``| **TestRail ID** | C<int> |`` row for ``tc_id``.

    The row is added as the first data row of the case's ``| Field | Value |``
    table (matching the FOUND-001 convention) or updated in place if present.
    Returns True when the file was modified.
    """
    lines = tc_file.read_text(encoding="utf-8").splitlines()
    heading_re = re.compile(rf"^####\s+{re.escape(tc_id)}\b")
    trow_re = re.compile(r"^\|\s*\*\*TestRail ID\*\*\s*\|")
    sep_re = re.compile(r"^\|\s*-+\s*\|\s*-+\s*\|\s*$")
    next_heading_re = re.compile(r"^####\s+TC-")

    start = next((i for i, ln in enumerate(lines) if heading_re.match(ln)), None)
    if start is None:
        log.warning("Could not find heading for %s in %s", tc_id, tc_file.name)
        return False

    end = len(lines)
    for i in range(start + 1, len(lines)):
        if next_heading_re.match(lines[i]):
            end = i
            break

    # Update in place if the row already exists within this case block.
    for i in range(start, end):
        if trow_re.match(lines[i]):
            if lines[i].strip() == _testrail_row(case_id):
                return False
            lines[i] = _testrail_row(case_id)
            tc_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
            return True

    # Otherwise insert right after the table separator (first data row).
    sep = next((i for i in range(start, end) if sep_re.match(lines[i])), None)
    if sep is None:
        log.warning("Could not find field table for %s in %s", tc_id, tc_file.name)
        return False
    lines.insert(sep + 1, _testrail_row(case_id))
    tc_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True


def update_traceability(tc_id: str, case_id: int, path: Path = TRACEABILITY_PATH) -> bool:
    """Set the final ``TestRail ID`` cell of ``tc_id``'s row from TBD to C<int>."""
    if not path.is_file():
        log.warning("TRACEABILITY.md not found at %s", path)
        return False
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = False
    for idx, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        cells = line.split("|")
        # cells[0] is empty (leading pipe); first real cell is cells[1].
        if len(cells) < 3:
            continue
        if cells[1].strip() == tc_id:
            cells[-2] = f" C{case_id} "
            lines[idx] = "|".join(cells)
            changed = True
            break
    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    else:
        log.warning("No TRACEABILITY row found for %s", tc_id)
    return changed


# --------------------------------------------------------------------------- #
# Planning helpers
# --------------------------------------------------------------------------- #

def _group_by_prefix(cases: list[Case]) -> "OrderedDict[str, list[Case]]":
    groups: OrderedDict[str, list[Case]] = OrderedDict()
    for case in cases:
        groups.setdefault(case.section_prefix, []).append(case)
    return groups


def _build_payload(
    case: Case,
    api_template_id: int | None,
    *,
    api_type_id: int,
    ui_type_id: int,
) -> dict:
    payload: dict = {"title": case.title, **case.custom}
    if api_template_id is not None and is_api_case(case):
        payload["template_id"] = api_template_id
    # Type column: API cases -> Type "API", UI cases -> Type "UI".
    type_id = case_type_id(case, api_id=api_type_id, ui_id=ui_type_id)
    if type_id is not None:
        payload["type_id"] = type_id
    # Automated checkbox: reflect the case's automation intent onto TestRail.
    automated = case_is_automated(case)
    if automated is not None:
        payload["custom_automated"] = automated
    return payload


# --------------------------------------------------------------------------- #
# Per-file publish
# --------------------------------------------------------------------------- #

def publish_file(
    tc_file: Path,
    *,
    dry_run: bool,
    skip_coverage_review: bool,
    sync_existing: bool,
) -> int:
    """Publish one TC file. Return 0 on success, non-zero when the gate blocks."""
    slug = gate.feature_slug(tc_file)

    if not gate.check_gate(slug, dry_run=dry_run, skip=skip_coverage_review):
        return 2

    us_root, cases = parse_tc_markdown(tc_file)
    if us_root is None:
        log.error("No 'User story / epic: US-*' header found in %s", tc_file)
        return 3
    log.info("User story / root section: %s", us_root)
    log.info("Parsed %d cases from %s", len(cases), tc_file)

    tr_map = load_testrail_map()
    already = [c for c in cases if c.tc_id in tr_map]
    to_publish = [c for c in cases if c.tc_id not in tr_map]
    log.info(
        "%d cases already published (skipped); %d to publish",
        len(already),
        len(to_publish),
    )

    # Type-id defaults (15/16) need no env, so the dry-run plan can show the
    # Type and Automated each case will publish with — no network required.
    api_type_id = settings.testrail_api_type_id()
    ui_type_id = settings.testrail_ui_type_id()

    if dry_run:
        _print_dry_run_plan(us_root, to_publish, api_type_id=api_type_id, ui_type_id=ui_type_id)
        if sync_existing and already:
            log.info("[DRY RUN] --sync-existing would update %d existing case(s)", len(already))
        return 0

    return _publish_live(
        tc_file,
        us_root,
        to_publish,
        already,
        sync_existing=sync_existing,
        api_type_id=api_type_id,
        ui_type_id=ui_type_id,
    )


def _type_label(type_id: int | None, api_type_id: int, ui_type_id: int) -> str:
    if type_id == api_type_id:
        return "API"
    if type_id == ui_type_id:
        return "UI"
    return "default"


def _print_dry_run_plan(
    us_root: str,
    to_publish: list[Case],
    *,
    api_type_id: int,
    ui_type_id: int,
) -> None:
    log.info("[DRY RUN] Root section: %s", us_root)
    if not to_publish:
        log.info("  (nothing to publish — all cases already in testrail_map.json)")
        return
    for prefix, group in _group_by_prefix(to_publish).items():
        log.info("  [%s] %d cases:", prefix, len(group))
        for case in group:
            type_id = case_type_id(case, api_id=api_type_id, ui_id=ui_type_id)
            automated = case_is_automated(case)
            log.info(
                "    %s (Type=%s, Automated=%s)",
                case.tc_id,
                _type_label(type_id, api_type_id, ui_type_id),
                "Yes" if automated else "No" if automated is False else "unset",
            )


def _publish_live(
    tc_file: Path,
    us_root: str,
    to_publish: list[Case],
    already: list[Case],
    *,
    sync_existing: bool,
    api_type_id: int,
    ui_type_id: int,
) -> int:
    # Fail loud on missing configuration before any network call.
    client = TestRailClient(
        base_url=settings.require_url(),
        username=settings.require_username(),
        api_key=settings.require_password(),
        project_id=settings.require_project_id(),
        suite_id=settings.require_suite_id(),
    )
    api_template_id = settings.testrail_api_template_id()

    def payload_for(case: Case) -> dict:
        return _build_payload(
            case, api_template_id, api_type_id=api_type_id, ui_type_id=ui_type_id
        )

    root_id = client.get_or_create_root_section(us_root)
    new_entries: dict[str, int] = {}

    for prefix, group in _group_by_prefix(to_publish).items():
        section_id = client.get_or_create_subsection(root_id, prefix)
        for case in group:
            created = client.add_case(section_id, payload_for(case))
            case_id = int(created["id"])
            log.info("Published %s -> TestRail case C%d", case.tc_id, case_id)
            new_entries[case.tc_id] = case_id
            update_markdown_testrail_id(tc_file, case.tc_id, case_id)
            update_traceability(case.tc_id, case_id)

    if new_entries:
        save_testrail_map(new_entries)
        log.info("Wrote %d new entries to testrail_map.json", len(new_entries))

    if sync_existing and already:
        tr_map = load_testrail_map()
        for case in already:
            case_id = tr_map[case.tc_id]
            client.update_case(case_id, payload_for(case))
            log.info("Synced existing %s -> TestRail case C%d", case.tc_id, case_id)

    return 0


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def _iter_files(args: argparse.Namespace) -> list[Path]:
    if args.file:
        return [Path(args.file)]
    folder = Path(args.folder)
    return sorted(folder.glob("TC-*.md"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="publish_manual_cases.py",
        description="Publish manual TC-*.md cases to TestRail (Step E).",
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--file", help="Path to a single testcases/TC-<FEATURE>.md file.")
    src.add_argument("--folder", help="Directory of TC-*.md files to publish.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the plan; make ZERO network calls and ZERO write-backs.",
    )
    parser.add_argument(
        "--skip-coverage-review",
        action="store_true",
        help="Bypass the Five-Lens gate (emergency only; logs a loud warning).",
    )
    parser.add_argument(
        "--sync-existing",
        action="store_true",
        help="Also update_case() for cases already present in testrail_map.json.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    args = build_parser().parse_args(argv)

    files = _iter_files(args)
    if not files:
        log.error("No TC-*.md files matched the requested --file / --folder.")
        return 1

    exit_code = 0
    for tc_file in files:
        if not tc_file.is_file():
            log.error("File not found: %s", tc_file)
            exit_code = exit_code or 1
            continue
        rc = publish_file(
            tc_file,
            dry_run=args.dry_run,
            skip_coverage_review=args.skip_coverage_review,
            sync_existing=args.sync_existing,
        )
        exit_code = exit_code or rc
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
