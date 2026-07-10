"""Step E — publish manual cases from testcases/TC-<FEATURE>.md to TestRail.

Usage:
  python3 publish_manual_cases.py --file ../../../testcases/TC-CEIQ-FOUND-001.md [--dry-run] [--skip-coverage-review]
"""
from __future__ import annotations

import argparse
import logging
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import coverage_review_gate
import parse_tc_markdown
import tc_id as tc_id_mod
import testrail_settings
from client import TestRailClient

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("publish_manual_cases")

_MODULE_SECTION_NAMES = {
    "AUTH": "Auth (JWT — both Cognito pools)",
    "TENANT": "Tenant isolation, context, and lifecycle",
    "RBAC": "RBAC / rights enforcement",
    "VENDOR": "Vendor secure link",
    "ADMIN": "Platform Admin isolation",
    "AUDIT": "Audit logging",
    "USER": "User lifecycle",
    "CACHE": "Rights cache (Redis)",
}


def _module_key(tc_id: str) -> str:
    m = re.match(r"TC-([A-Z]+)-\d+", tc_id)
    return m.group(1) if m else "OTHER"


def _feature_slug(tc_file: pathlib.Path) -> str:
    # testcases/TC-CEIQ-FOUND-001.md -> CEIQ-FOUND-001
    return tc_file.stem.removeprefix("TC-")


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish manual test cases to TestRail (Step E).")
    parser.add_argument("--file", required=True, help="Path to testcases/TC-<FEATURE>.md")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--skip-coverage-review", action="store_true")
    parser.add_argument("--user-story-id", default=None)
    args = parser.parse_args()

    tc_file = pathlib.Path(args.file).resolve()
    repo_root = tc_file.parent.parent
    traceability_file = tc_file.parent / "TRACEABILITY.md"
    testrail_map_file = tc_file.parent / "testrail_map.json"

    feature_slug = _feature_slug(tc_file)
    review_path_check = repo_root / "documents" / "output" / "Manual TC Coverage Review" / f"REVIEW_{feature_slug}_FIVE_LENS.md"
    import os

    os.chdir(repo_root)
    coverage_review_gate.check_publish_allowed(feature_slug, skip_gate=args.skip_coverage_review)
    logger.info("Coverage gate satisfied for %s (%s)", feature_slug, review_path_check)

    user_story_id = args.user_story_id or parse_tc_markdown.extract_user_story_header(tc_file)
    logger.info("User story / root section: %s", user_story_id)

    cases = parse_tc_markdown.parse_feature(tc_file, traceability_file, testrail_settings.testrail_api_template_id())
    logger.info("Parsed %d cases from %s", len(cases), tc_file)

    existing_map = tc_id_mod.load_testrail_map(testrail_map_file)
    to_publish = [c for c in cases if c["tc_id"] not in existing_map]
    logger.info("%d cases already published (skipped); %d to publish", len(cases) - len(to_publish), len(to_publish))

    if args.dry_run:
        print(f"[DRY RUN] Root section: {user_story_id}")
        by_module: dict[str, list[str]] = {}
        for case in to_publish:
            by_module.setdefault(_module_key(case["tc_id"]), []).append(case["tc_id"])
        for module_key, ids in by_module.items():
            section_name = _MODULE_SECTION_NAMES.get(module_key, module_key)
            print(f"  [{section_name}] {len(ids)} cases: {', '.join(ids)}")
        return 0

    client = TestRailClient()
    project_id = testrail_settings.testrail_project_id()
    suite_id = testrail_settings.testrail_suite_id()

    root_section = client.get_or_create_root_section(project_id, user_story_id, suite_id=suite_id)
    root_section_id = root_section["id"]
    logger.info("Root section id=%s", root_section_id)

    module_section_ids: dict[str, int] = {}
    new_map: dict[str, int] = dict(existing_map)

    for case in to_publish:
        module_key = _module_key(case["tc_id"])
        section_name = _MODULE_SECTION_NAMES.get(module_key, module_key)
        if module_key not in module_section_ids:
            section = client.get_or_create_child_section(project_id, section_name, root_section_id, suite_id=suite_id)
            module_section_ids[module_key] = section["id"]
            logger.info("Section %r id=%s", section_name, section["id"])

        section_id = module_section_ids[module_key]
        result = client.add_case(section_id, case["title"], **case["payload"])
        case_id = result["id"]
        new_map[case["tc_id"]] = case_id
        logger.info("Published %s -> TestRail case C%s", case["tc_id"], case_id)

    tc_id_mod.save_testrail_map(testrail_map_file, new_map)
    logger.info("Wrote %s (%d entries)", testrail_map_file, len(new_map))

    _write_ids_into_tc_file(tc_file, new_map)
    _write_ids_into_traceability(traceability_file, new_map)

    print(f"Published {len(to_publish)} new cases; {len(new_map)} total mapped in {testrail_map_file}")
    return 0


def _write_ids_into_tc_file(tc_file: pathlib.Path, mapping: dict[str, int]) -> None:
    text = tc_file.read_text(encoding="utf-8")
    blocks = parse_tc_markdown._split_blocks(text)
    changed = False
    new_blocks = []
    for block in blocks:
        heading = block.splitlines()[0] if block.splitlines() else ""
        ids_in_heading = tc_id_mod.extract_tc_id_from_text(heading)
        target_id = next((i for i in ids_in_heading if i in mapping), None)
        if target_id and "**TestRail ID**" not in block:
            lines = block.splitlines(keepends=True)
            for idx, line in enumerate(lines):
                if line.strip().startswith("| **Spec reference**"):
                    lines.insert(idx, f"| **TestRail ID** | C{mapping[target_id]} |\n")
                    changed = True
                    break
            block = "".join(lines)
        elif target_id and "**TestRail ID**" in block:
            block = re.sub(
                r"\| \*\*TestRail ID\*\* \|.*?\|",
                f"| **TestRail ID** | C{mapping[target_id]} |",
                block,
                count=1,
            )
            changed = True
        new_blocks.append(block)
    if changed:
        tc_file.write_text("".join(new_blocks), encoding="utf-8")
        logger.info("Wrote TestRail IDs back into %s", tc_file)


def _write_ids_into_traceability(traceability_file: pathlib.Path, mapping: dict[str, int]) -> None:
    text = traceability_file.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    header_idx = next(i for i, l in enumerate(lines) if l.strip().startswith("| TC-ID"))
    if "TestRail ID" not in lines[header_idx]:
        lines[header_idx] = lines[header_idx].rstrip("\n").rstrip("|") + " TestRail ID |\n"
        sep_idx = header_idx + 1
        lines[sep_idx] = lines[sep_idx].rstrip("\n").rstrip("|") + "--------|\n"
        for i in range(sep_idx + 1, len(lines)):
            m = re.match(r"\|\s*(TC-[A-Z]+-\d+)\s*\|", lines[i])
            if not m:
                continue
            tc_id = m.group(1)
            trid = f" C{mapping[tc_id]} |" if tc_id in mapping else " TBD |"
            lines[i] = lines[i].rstrip("\n").rstrip("|") + trid + "\n"
    else:
        for i, line in enumerate(lines):
            m = re.match(r"\|\s*(TC-[A-Z]+-\d+)\s*\|", line)
            if not m or m.group(1) not in mapping:
                continue
            lines[i] = re.sub(r"\|\s*(TBD|C\d+)\s*\|(?=\s*\n?$)", f" C{mapping[m.group(1)]} |", line)
    traceability_file.write_text("".join(lines), encoding="utf-8")
    logger.info("Wrote TestRail IDs back into %s", traceability_file)


if __name__ == "__main__":
    raise SystemExit(main())
