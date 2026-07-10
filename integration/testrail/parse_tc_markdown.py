"""Parse testcases/TC-<FEATURE>.md (+ TRACEABILITY.md) into TestRail case payloads.

TRACEABILITY.md is the canonical list of TC-IDs (one row per case, even when several
IDs share one narrative block in the TC file via a parameter/sub-case table). For each
TC-ID we locate its describing block in the TC file (the nearest `#### ` heading that
mentions that ID) and extract Module/Layer, Type, Priority, Preconditions, Steps,
Expected results, and Automation readiness from the field table and any parameter table.
"""
from __future__ import annotations

import pathlib
import re

_TC_ID_RE = re.compile(r"TC-[A-Z]+-\d+")

_TYPE_TO_TESTRAIL_TYPE_ID = {
    # TestRail default case-type ids: 6=Other, 7=Regression, 8=Security, 1=Acceptance ...
    # Left as a simple, overridable default — instance-specific type ids are not guessed beyond "Other".
}

_PRIORITY_TO_TESTRAIL_PRIORITY_ID = {
    "P0": 4,  # Critical (TestRail default ordering: 1=Low,2=Medium,3=High,4=Critical)
    "P1": 3,
    "P2": 2,
    "P3": 1,
}


def parse_traceability_rows(path: str | pathlib.Path) -> list[dict]:
    text = pathlib.Path(path).read_text(encoding="utf-8")
    rows = []
    for line in text.splitlines():
        m = re.match(r"\|\s*(TC-[A-Z]+-\d+)\s*\|(.*)\|(.*)\|(.*)\|(.*)\|(.*)\|$", line)
        if not m:
            continue
        rows.append(
            {
                "tc_id": m.group(1).strip(),
                "spec_reference": m.group(2).strip(),
                "module_layer": m.group(3).strip(),
                "automation_path": m.group(4).strip(" `"),
                "to_be_automated": m.group(5).strip(),
                "status": m.group(6).strip(),
            }
        )
    return rows


def _split_blocks(tc_markdown: str) -> list[str]:
    return re.split(r"\n(?=#### )", tc_markdown)


def _extract_field(block: str, field_name: str) -> str:
    m = re.search(rf"\|\s*\*\*{re.escape(field_name)}\*\*\s*\|\s*(.*?)\s*\|\s*\n", block)
    return m.group(1).strip() if m else ""


def find_block_for_tc_id(blocks: list[str], tc_id: str) -> str | None:
    # Prefer a block whose heading line contains the id.
    for block in blocks:
        heading = block.splitlines()[0] if block.splitlines() else ""
        if tc_id in heading:
            return block
    # Fall back to any block that mentions the id anywhere (parameter tables).
    for block in blocks:
        if tc_id in block:
            return block
    return None


def build_case_payload(tc_id: str, block: str, traceability_row: dict, api_template_id: int) -> dict:
    heading_line = block.splitlines()[0] if block else f"#### {tc_id}"
    title_match = re.match(r"#### (.+?) — (.+)", heading_line)
    title = f"{tc_id} — {title_match.group(2).strip()}" if title_match else f"{tc_id}"

    case_type = _extract_field(block, "Type") or "Positive"
    priority = _extract_field(block, "Priority") or "P2"
    preconditions = _extract_field(block, "Preconditions") or "See spec."
    steps = _extract_field(block, "Steps") or "See test case body."
    expected = _extract_field(block, "Expected results") or "See test case body."
    automation_readiness = _extract_field(block, "Automation readiness")
    spec_ref = traceability_row.get("spec_reference", "")
    module_layer = traceability_row.get("module_layer", "")

    description_lines = [
        f"**Spec reference:** {spec_ref}",
        f"**Module / Layer:** {module_layer}",
        f"**Type:** {case_type}",
        "",
        f"**Preconditions:** {preconditions}",
        "",
        f"**Steps:** {steps}",
        "",
        f"**Expected results:** {expected}",
        "",
        f"**Automation readiness:** {automation_readiness}",
        "",
        "_Full detail: `testcases/TC-CEIQ-FOUND-001.md`._",
    ]

    payload = {
        "custom_preconds": preconditions,
        "custom_steps": steps,
        "custom_expected": expected,
        "priority_id": _PRIORITY_TO_TESTRAIL_PRIORITY_ID.get(priority.split(",")[0].strip(), 2),
        "refs": spec_ref[:250] if spec_ref else None,
    }
    if "API" in module_layer:
        payload["template_id"] = api_template_id

    return {
        "tc_id": tc_id,
        "title": title,
        "description": "\n".join(description_lines),
        "module_layer": module_layer,
        "payload": {k: v for k, v in payload.items() if v is not None},
    }


def parse_feature(tc_markdown_path: str | pathlib.Path, traceability_path: str | pathlib.Path, api_template_id: int) -> list[dict]:
    tc_text = pathlib.Path(tc_markdown_path).read_text(encoding="utf-8")
    blocks = _split_blocks(tc_text)
    rows = parse_traceability_rows(traceability_path)

    cases = []
    for row in rows:
        tc_id = row["tc_id"]
        block = find_block_for_tc_id(blocks, tc_id)
        if block is None:
            cases.append(
                {
                    "tc_id": tc_id,
                    "title": f"{tc_id} — (narrative not found in TC file; see TRACEABILITY.md)",
                    "description": f"**Spec reference:** {row['spec_reference']}\n**Module / Layer:** {row['module_layer']}",
                    "module_layer": row["module_layer"],
                    "payload": {},
                }
            )
            continue
        cases.append(build_case_payload(tc_id, block, row, api_template_id))
    return cases


def extract_user_story_header(tc_markdown_path: str | pathlib.Path) -> str:
    text = pathlib.Path(tc_markdown_path).read_text(encoding="utf-8")
    m = re.search(r"\*\*User story / epic:\*\*\s*(\S+)", text)
    if not m:
        raise ValueError(f"No '**User story / epic:** US-<ID>' header found in {tc_markdown_path}")
    return m.group(1)
