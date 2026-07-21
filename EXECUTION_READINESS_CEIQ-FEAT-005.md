# Automation execution readiness — CEIQ-FEAT-005 (Vendor Directory)

**Date:** 2026-07-21
**Author:** QA Automation Lead (agent) — orchestrator Phase C / Step 5 (mock/offline run)
**Spec:** `documents/input/SPEC_CEIQ-FEAT-005-vendor-directory.md` (v1.1, Draft)
**Manual suite:** `testcases/TC-CEIQ-FEAT-005.md` (159 cases) · **Five-Lens:** `documents/output/Manual TC Coverage Review/REVIEW_CEIQ-FEAT-005_FIVE_LENS.md` (all lenses ≥ 80%, gate PASS)
**Surface (§2):** Mixed — API Vitest-TS (`automation/api-ts/`) + Playwright (`automation/frontend/`)

---

## Verdict — EXECUTION BLOCKED (no fabricated runs)

Automation **execution cannot be run this cycle** and **no TC may be labelled `Automated`**. The manual suite is authoring-complete and Five-Lens-approved for hand-off, but every automatable leg depends on artifacts that **do not exist yet**. This is an honest readiness/blocker report per `reporting.rules` + the orchestrator contract; it is **not** a run summary and reports **zero** passed/failed/skipped executions because nothing was executed.

Per the orchestrator's "scaffold OR blocker report" rule: full skipped scaffolds for all 112 automatable legs would require inventing vendor API clients, payload/schema modules, Page Objects, and locators against an unbuilt module — speculative code that cannot run cleanly and would risk polluting the suite and the TC-id reporter. This report is the chosen deliverable; §5 below specifies the exact scaffold a follow-up authoring pass should create once the blockers clear.

---

## 1. What exists vs what is missing

| Layer | Exists today | Missing (blocks execution) |
|-------|--------------|-----------------------------|
| **API (Vitest-TS)** | `automation/api-ts/` project (config, envs, `src/{clients,payloads,schemas,utils}`, reporters, testrail); prior-feature suites (auth, admin, tenants, companySettings, rbac, audit, cache) run for real on Local | `/api/v1/vendors*` (19 routes) + `/api/v1/vendor-categories` not in the backend build; no `VendorsClient`/`vendorCategoriesClient`; no vendor payload/schema modules; no vendor DB fixtures |
| **Database** | Local Postgres reachable; `createFixtureTenantAndUser` / `withDbClient` fixtures used by companySettings suite | `vendors` / `vendor_contacts` / `vendor_compliance_documents` / `vendor_categories` tables; `tenants.vendor_display_id_seq` column + backfill; partial unique indexes; status CHECK; RLS on the 3 tenant-scoped tables; category seed (§4) |
| **UI (Playwright)** | `automation/frontend/` project; prior-feature specs (login, tenant-*, company-settings-*); Page Object + locator convention | tenant-app `E2E_BASE_URL` unconfirmed; `/vendors` + `/vendors/:id` routes not confirmed built; **no `data-testid` contract in the spec** (TC-file §6 is a *proposed* contract awaiting frontend confirmation); no vendor Page Objects/locators |
| **RBAC seeding** | F1 `manage_vendors` / `view_vendors` rights defined in spec | `view_sourcing` / `manage_sourcing` rights — presence in the RBAC seed **unknown**; dual-right / single-right test tokens not provisionable yet (blocks TC-VDSEC-003…006) |
| **Sourcing / Contracts** | — | Both are **stubbed interface contracts** (§1.2). No live service; PARTIAL legs automatable only against an interface mock; live verification re-homes to those suites |
| **S3** | AWS SDK usable in principle | No provisioned S3 test bucket for real presigned upload/confirm/download; live-object legs blocked (DB + validation legs mockable) |

> **Note — do not confuse files.** `automation/api-ts/tests/vendor.test.ts` already exists but belongs to **CEIQ-FOUND-001** (`TC-VENDOR-001…003`, external vendor *secure-link* session — a different concept). FEAT-005 Vendor Directory specs are **new, separate files** (`TC-VDAPI-*`/`TC-VDUI-*`) and must not be merged into that FOUND-001 file.

---

## 2. Blocker list (authoritative — mirrors TC-file §10)

1. **Vendor module + migrations absent** — the 19 `/api/v1/vendors*` routes, 4 tables, `vendor_display_id_seq`, partial unique indexes, RLS, and category seed are new in this spec and not in the local backend. Blocks all `API-AUTOMATION` + DB legs.
2. **Tenant-app URL + `/vendors` routes + `data-testid`s absent** — blocks all `UI-AUTOMATION` legs; the selector contract (TC-file §6) is a proposal pending frontend confirmation.
3. **`view_sourcing` / `manage_sourcing` RBAC seeding unknown** — blocks the dual-right security cases (TC-VDSEC-003…006).
4. **Sourcing module stubbed** — blocks/PARTIALs TC-VDAPI-080/085/095/098/100, TC-VDSEC-003…006, TC-VDUI-056/057/058/061/063/066, delete-open-participation (TC-VDAPI-042).
5. **Contracts module stubbed** — blocks/PARTIALs TC-VDAPI-021/075/090, delete-active-contracts (TC-VDAPI-041), TC-VDUI-022/024/041/048, `contractCount`/`upcomingActionsCount` in TC-VDAPI-015/030.
6. **S3 live bucket absent** — real presigned ops in TC-VDAPI-060/064/066/067/069, TC-VDDB-008, TC-VDSEC-009, TC-VDUI-060 (DB + validation legs mockable).
7. **MANUAL-ONLY** — TC-VDAPI-008 (999,999 cap — needs a backend test hook, not a million seeded rows) and TC-VDUI-066 (inactive-award block — control lives on the not-built Sourcing screen).

---

## 3. Automatable-leg inventory (what becomes runnable once blockers clear)

Per the TC-file §8 tags (authoritative per case):

| Tag | Count | Runnable when |
|-----|-------|---------------|
| `API-AUTOMATION` (Vitest-TS, incl. DB-paired) | 66 | Vendor module + 4-table migration + RLS + category seed on a tenant-scoped test DB |
| `UI-AUTOMATION` (Playwright) | 46 | Tenant-app `E2E_BASE_URL` + `/vendors` routes + real/confirmed `data-testid`s |
| `PARTIAL` | 45 | The automatable portion runs with Sourcing/Contracts/S3 **mocked at the interface**; the live portion re-homes to those suites |
| `MANUAL-ONLY` | 2 | Manual execution / backend unit test with stubbed counter |

**None** of these can produce a passing run today. The 45 `PARTIAL` + 2 `MANUAL-ONLY` tags in the TC file already record the blocked legs precisely.

---

## 4. Traceability status

- `testcases/TRACEABILITY.md` already carries the FEAT-005 rows with per-case `Automation path = TBD` and the `ToBeAutomated` tag. **No path is changed to a real `file::test` this cycle** because no test files were authored or run. When Phase C authoring proceeds, `qa-testrail-cqm-sync` (Step 4b) will inject TC-ids and fill real paths in the same change.

---

## 5. Recommended scaffold (for the follow-up Phase C pass — not created now)

When blockers 1–2 clear, author (matching the existing `automation/api-ts/` + `automation/frontend/` conventions and the `test.skip("… [blocked: reason]")` precedent in the FOUND-001 `vendor.test.ts`):

**API (`automation/api-ts/`):**
- `src/clients/vendorsClient.ts` (+ `vendorCategoriesClient.ts`) — one client per surface; base URL from `settings`/env, never literal.
- `src/payloads/vendorPayloads.ts` (create/update bodies + factories; negative variants), `src/payloads/vendorDocumentPayloads.ts`.
- `src/schemas/vendor.schema.json`, `vendorList.schema.json`, `vendorProfile.schema.json` for response validation.
- `src/utils/vendorDbFixtures.ts` — seed tenant + Owner/Manager/Analyst + second tenant; direct-DB assertions for `TC-VDDB-*`.
- `tests/vendors.crud.test.ts`, `vendors.list.test.ts`, `vendors.status-primary-spend.test.ts`, `vendors.documents.test.ts`, `vendors.sourcing-delegated.test.ts` (Sourcing/Contracts mocked), `vendors.categories.test.ts`, `vendors.security.test.ts` — each case tagged `TC-VDAPI-*`/`TC-VDSEC-*`/`TC-VDDB-*` in the title/docstring; every response asserts status + `assertResponseTime` + echo + schema; no data-driven `.each` (numeric-suffix siblings per §9 automation-readiness).

**UI (`automation/frontend/`):**
- `locators/vendors.ts` (from the confirmed test-id contract), `pages/VendorTablePage.ts`, `VendorFormModal.ts`, `VendorProfilePage.ts`.
- `tests/vendors-add.spec.ts`, `vendors-edit-delete.spec.ts`, `vendors-table.spec.ts`, `vendors-profile.spec.ts`, `vendors-access.spec.ts` — `TC-VDUI-*`/`TC-VDACCESS-*` in titles; explicit waits only; no `waitForTimeout`.

Until blockers 1–2 clear, these files are **not** written — speculative stubs against a non-existent module would not run cleanly and would risk TC-id reporter collisions.

---

## 6. Definition of done for a *real* execution cycle (not met this cycle)

- [ ] Vendor module + migrations + RLS + category seed deployed to a tenant-scoped test DB
- [ ] Tenant-app `E2E_BASE_URL` + `/vendors` routes + confirmed `data-testid`s
- [ ] `view_sourcing`/`manage_sourcing` rights seeded; dual/single-right tokens provisionable
- [ ] Sourcing + Contracts interfaces available (live or mocked); S3 test bucket provisioned
- [ ] Phase C authoring + `qa-testrail-cqm-sync` (TC-ids + real traceability paths)
- [ ] `run_sequential_and_report.py` executed (flush-before-run), producing `last_run.json` + HTML with real pass/fail evidence
- [ ] Only then: label passing TCs `Automated` in `TC-CEIQ-FEAT-005.md` + `TRACEABILITY.md`

**Current cycle result: 0 executed, 0 passed, 0 failed, 0 flaky — execution blocked. No `Automated` labels applied.**
