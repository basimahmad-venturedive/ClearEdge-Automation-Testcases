# TestRail manual-case publisher (Step E)

Publishes manual test cases from `testcases/TC-<FEATURE>.md` into TestRail,
creating a `US-*` root section and per-prefix sub-sections, and writing the
resulting case ids back into the repo. Standalone, stdlib-only HTTP (no
`requests` dependency).

## What it does

For each TC file:

1. **Coverage gate** — requires `documents/output/Manual TC Coverage Review/REVIEW_<slug>_FIVE_LENS.md`
   to contain `TestRail publish allowed | Yes` before a live publish.
2. **Parse** — reads the `**User story / epic:** US-XXX` header (the root
   section name) and every `#### TC-… — …` case with its `| Field | Value |`
   table (Priority, Type, Preconditions, Test data, Steps, Expected results,
   Module / Layer).
3. **Sections** — reuses or creates the `US-*` root section, then a sub-section
   per TC-ID mid-segment (`TC-UAUTH-LOGIN-001` → `UAUTH-LOGIN`). Existing
   sections are never duplicated.
4. **Publish** — for each case **not** already in `testcases/testrail_map.json`,
   calls `add_case`. Cases whose Module / Layer mentions **API** get
   `template_id = TESTRAIL_API_TEMPLATE_ID`.
5. **Write-backs** (live only, per newly published case):
   - `testcases/testrail_map.json` — merge `"<TC-ID>": <int>` (flat object,
     existing keys preserved).
   - the TC markdown — insert/update a `| **TestRail ID** | C<int> |` row as the
     first data row of the case table.
   - `testcases/TRACEABILITY.md` — set the row's final `TestRail ID` cell from
     `TBD` to `C<int>`.

Already-mapped TC-IDs are **skipped** (idempotent). `--sync-existing` re-pushes
their fields via `update_case`.

## Environment setup

```bash
cp automation/integration/testrail/.env.example automation/integration/testrail/.env
# then edit .env with your TESTRAIL_URL / USERNAME / API key / PROJECT_ID / SUITE_ID
python -m pip install -r automation/integration/testrail/requirements.txt
```

`.env` is searched module-local first, then the repo root. It is never
committed. A live publish fails loudly, naming the missing variable and file, if
any required value is absent. `--dry-run` reads no credentials at all.

## Usage

```bash
# Offline plan — zero network calls, zero write-backs:
python automation/integration/testrail/publish_manual_cases.py \
    --file testcases/TC-CEIQ-FEAT-002.md --dry-run

# Live publish of one feature:
python automation/integration/testrail/publish_manual_cases.py \
    --file testcases/TC-CEIQ-FEAT-002.md

# Publish every TC-*.md in a folder:
python automation/integration/testrail/publish_manual_cases.py \
    --folder testcases/

# Also update fields of already-published cases:
python automation/integration/testrail/publish_manual_cases.py \
    --file testcases/TC-CEIQ-FEAT-002.md --sync-existing
```

### Flags

| Flag | Effect |
|------|--------|
| `--file PATH` / `--folder DIR` | Source (mutually exclusive, one required). |
| `--dry-run` | Print the plan; make **no** network calls and **no** writes. |
| `--skip-coverage-review` | Bypass the Five-Lens gate (emergency only; loud warning). |
| `--sync-existing` | `update_case` for TC-IDs already in `testrail_map.json`. |

Exit code is non-zero when the coverage gate blocks a live publish.
