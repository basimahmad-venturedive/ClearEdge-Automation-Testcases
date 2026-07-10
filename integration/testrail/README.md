# TestRail integration (Step E — publish manual cases)

Publishes `testcases/TC-<FEATURE>.md` to TestRail under a root section named after the
User story ID (`**User story / epic:** US-<ID>` in the TC file header), gated on the
Five-Lens coverage review approving publish.

## Setup

```bash
cp .env.example .env   # fill in TESTRAIL_URL / USERNAME / PASSWORD / PROJECT_ID / SUITE_ID
python3 -m pip install -r requirements.txt
```

**Never commit `.env`.** It's covered by the repo's `**/.env` gitignore pattern.

## Usage

```bash
# Preview only
python3 publish_manual_cases.py --file ../../../testcases/TC-<FEATURE>.md --dry-run

# Publish (writes TestRail IDs back into the TC file, TRACEABILITY.md, testrail_map.json)
python3 publish_manual_cases.py --file ../../../testcases/TC-<FEATURE>.md
```

Cases already published (TestRail ID present in `testcases/testrail_map.json`) are skipped —
safe to re-run after adding new cases to the same TC file.

## This project's instance

- **Instance:** `https://vdqa.testrail.io`, project **"ClearEdge"** (id 110), suite **7599** ("Master", single-suite-mode project).
- **`TESTRAIL_API_TEMPLATE_ID=5`** ("BE Test Cases") — this instance does **not** have a template id 6; discovered via `get_templates` and confirmed against `get_case_fields` before first publish. If you add a project on a different instance, re-check `get_templates/{project_id}` rather than assuming 5 or 6.
- Cases are organized under one root section per User story ID, with a child section per module (matching the `### Module:` groupings in the TC file) — this is an enhancement on top of the kit's mandatory root-section rule, not a requirement from the rule itself.

## CEIQ-FOUND-001 (F1) — published 2026-07-07

58 cases published under root section **US-RBAC** → 8 module sub-sections. Mapping: `testcases/testrail_map.json`. TestRail IDs also written into `testcases/TC-CEIQ-FOUND-001.md` (one case per distinct `#### ` heading — cases sharing a heading via a parameter/sub-case table, e.g. `TC-AUTH-003`/`TC-AUTH-004`, are tracked in `testrail_map.json` and `TRACEABILITY.md` but do not get their own `**TestRail ID**` row in the narrative block) and `testcases/TRACEABILITY.md` (authoritative for every ID, no exceptions).

## Not yet built (Step H — automation run posting)

`create_automation_run.py` / `post_automation_run.py` / `automation/integration/post_run_integrations.py` are not scaffolded yet — no automation has executed for this project (see `automation/README.md`). Build these when execution becomes possible; the JSON contract is documented in `.claude/agents/testrail-integration.md` §"Step H".
