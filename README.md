# Automation — CEIQ-FOUND-001 (F1)

**Layer:** API only (TypeScript / Vitest) — this feature has no UI (see `documents/output/Test Plan/TEST_PLAN_CEIQ-FOUND-001.md` §1).

**Stack directive (project-wide, user confirmed 2026-07-07):** API automation on this project always uses **TypeScript** (`api-automation-ts` agent, Vitest + axios + Zod, `automation/api-ts/`) — never Python. See `documents/input/PROJECT_CONTEXT.md` §4 / §12.

## Current state: scaffolded, not executable

58 test cases are written as real Vitest specs under `automation/api-ts/tests/` (80 test items once `test.each` parametrization is counted), each tagged with its `TC-ID` in the test title and traceable via `testcases/TRACEABILITY.md`. **Every test is `test.skip(...)`** with the reason embedded in the title, naming exactly what's missing:

1. **No environment** — no AWS/Cognito/RDS/Redis exists for this project yet (`documents/input/PROJECT_CONTEXT.md` §5; this spec's own §1.1 Prerequisites explicitly says infra is "provisioned as infrastructure — not generated from this spec").
2. **No confirmed endpoint contract** — `CEIQ-FOUND-001` defines guard/interceptor *behavior*, not REST paths (spec §1.3: "no feature-level endpoints"). Every `src/clients/controlPlaneClient.ts::TODO_ENDPOINT_*` constant is a placeholder pending the Admin Portal / User Management feature specs that own the actual paths.

Nothing here is fabricated: no test claims a pass/fail result, and no endpoint path is guessed and asserted against as if confirmed.

## What's real and runnable today (offline, no environment needed)

- `src/utils/jwtHelpers.ts` — mints tenant-pool and admin-pool JWTs matching the exact claim shapes in spec §7.2 (`sub`/`tenant_id`/`role_id`/`email` for tenant pool; `sub`/`email`/`admin` for admin pool), signed with a disposable per-run RSA keypair (via `jose`). This can be exercised right now without any live Cognito.
- `src/config/env.ts` — typed env accessor; missing `API_BASE_URL` throws (fail loud), missing secrets are the caller's responsibility to `test.skip()` naming the variable — per `.claude/rules/secrets-and-env.rules.md`.
- `src/utils/assertions.ts` — `assertResponseTime` / `assertRequestEchoedInResponse` / `assertErrorEnvelope`, ready to use the moment real responses exist.
- `src/schemas/identityRbacSchemas.ts` — Zod schemas for the documented `tenants` / `users` response shapes and the error envelope (§9.2).

Verify the scaffold compiles and collects correctly:

```bash
cd automation/api-ts
npm install
npx tsc --noEmit          # strict type-check, zero errors
npx vitest run            # should list 80 test items, all "skipped", none as errors
```

## Test execution — against the local Docker backend

The backend can now be run locally via Docker Compose (`codebase/clearedge-backend/docker-compose.yml`): **app on host `:3001`, Postgres on `:5433`, Redis on `:6379`**. `envs/.env.local` is already pointed at these (`API_BASE_URL=http://127.0.0.1:3001/api/v1`, `TEST_DATABASE_URL=…@localhost:5433/clearedge`).

**Prerequisites — bring the stack up (from the backend repo):**

```bash
# 1) JWKS mock (host :4001) — signs the test JWTs. Leave it running in its own shell:
cd automation/api-ts && npm run local:jwks-mock

# 2) Backend stack. Host 5432 is held by a local Postgres service, so publish the
#    container DB on 5433. The app must reach the JWKS mock at host.docker.internal
#    (inside a container, "localhost" is the container, not your host):
cd ../../codebase/clearedge-backend           # i.e. <repo-root>/codebase/clearedge-backend
DATABASE_PORT=5433 \
COGNITO_TENANT_JWKS_URI=http://host.docker.internal:4001/tenant-pool/.well-known/jwks.json \
COGNITO_ADMIN_JWKS_URI=http://host.docker.internal:4001/admin-pool/.well-known/jwks.json \
docker compose up -d --build

# 3) Migrate + seed the container DB (a fresh volume has no schema):
docker compose exec -T app npm run migration:run:prod
docker compose exec -T app npm run seed:rights:prod
```

> **PowerShell** (this machine): set the three vars first, then run compose —
> ```powershell
> $env:DATABASE_PORT='5433'
> $env:COGNITO_TENANT_JWKS_URI='http://host.docker.internal:4001/tenant-pool/.well-known/jwks.json'
> $env:COGNITO_ADMIN_JWKS_URI='http://host.docker.internal:4001/admin-pool/.well-known/jwks.json'
> docker compose --project-directory E:\ClearEdge\codebase\clearedge-backend up -d --build
> ```

**Run the API tests** (`LOCAL_COGNITO_HOST` makes the minted token `iss` match the app's configured issuer — required when the backend is in Docker):

```bash
cd automation/api-ts

# whole suite (TEST_ENV=local → envs/.env.local):
LOCAL_COGNITO_HOST=host.docker.internal npm run test:local

# a single spec file:
LOCAL_COGNITO_HOST=host.docker.internal npm run test:local -- tests/auth.test.ts
```

```powershell
# PowerShell equivalent:
cd automation\api-ts
$env:LOCAL_COGNITO_HOST='host.docker.internal'
npm run test:local                          # whole suite
npm run test:local -- tests/auth.test.ts    # single file
```

Other run modes (from `automation/api-ts/package.json`): `npm test` (default `vitest run`), `npm run test:watch`, `npm run test:coverage`, `npm run test:qa` / `test:prod` (select `envs/.env.qa` / `.env.prod`).

**Current known state of a local run:** `auth.test.ts` → 7/8 pass. The CEIQ-FEAT-001 admin-portal specs stay `test.skip` until the `/api/v1/admin/*` endpoints ship; DB-backed FOUND-001 tests are blocked by a backend defect (`column Tenant.setupStatus does not exist` — missing `name:` column mappings in `codebase/clearedge-backend/src/tenant/entities/tenant.entity.ts`).

## Once a shared (QA/staging) environment exists

1. Copy `.env.example` → `.env`, fill in real Cognito pool IDs, `API_BASE_URL`, Redis, and a QA/staging-only `TEST_DATABASE_URL`.
2. Replace every `TODO_ENDPOINT_*` constant in `src/clients/controlPlaneClient.ts` with the real, spec-confirmed path once the Admin Portal / User Management feature specs land.
3. Remove the corresponding `test.skip(...)` → `test(...)` per test as its dependency clears.
4. Run: `npm test` (or `npm run test:live` for `USE_MOCK=0`), or via the future `automation/scripts/run_sequential_and_report.py` orchestrator once a second layer exists to justify one — see `.claude/rules/execution.rules.md`.

## HTML execution report

Every `vitest run` (any script in `automation/api-ts/package.json`) writes a self-contained, ExtentReports-style HTML dashboard to:

```
automation/reports/html/api/latest.html
```

Open it directly in a browser after a run — it shows total/passed/failed/skipped counts, a pass-rate donut, and, per failure, the expected-vs-actual message plus a collapsible stack trace (sensitive headers/tokens are redacted before being written). The report is regenerated (overwritten) on every run — it always reflects the latest execution, not a history. Implementation: `automation/api-ts/reporters/extentReporter.ts`, wired in via `reporters` in `automation/api-ts/vitest.config.ts`.

## TestRail & CQM integration

Both layers are wired for TestRail result publishing and CQM automation-stats
reporting as **runner reporters**, following the VentureDive QA automation
boilerplates (`qa-automation-boilerplates`: `BE-Automation` for `api-ts`,
`FE-Boilerplate` for `frontend`). Both are **opt-in** and completely silent
unless their env flag is set — ordinary `npm test` runs are unaffected. The
older Python `automation/integration/testrail` publisher has been retired in
favour of this JS flow.

**Where things live** (per layer — `api-ts/` = `.cjs`, `frontend/` = `.js`):

- `reporters/testrailReporter.*` — posts results to a TestRail run.
- `reporters/cqmReporter.*` (+ `cqmDirect.*`) — inserts `automation_run` +
  `test_case_execution` rows. Dual path: **AWS** Secrets Manager via the optional
  private `@test/integrations`, or **direct** SSH-bastion + MySQL. It auto-routes
  by which env vars are present (`CQM_DIRECT_DB=1` forces direct).
- `testrail/` — client, mapping store, importer, run creator, result publisher,
  markdown parser. `testrail/mappingStore/caseMapping.json` maps `TC-…` ids →
  TestRail case ids; it is **seeded from `testcases/testrail_map.json`** (the
  already-published ClearEdge project 110 cases), so no re-import is needed.

**TestRail — publish an automated run** (fill `TESTRAIL_*` in `.env` first):

```bash
cd automation/api-ts        # or automation/frontend
npm run testrail:create-run # creates a run from the active TC-ids in the mapping
npm run testrail:execute    # runs the suite and publishes results to that run
```

`npm run testrail:import` (re-)creates the mapping from a `testcases/TC-*.md`
file — **only run it for brand-new cases**; it creates cases in TestRail and
would duplicate the 150 already published for project 110.

**CQM — enable stats insertion:** set `CQM_INTEGRATION=1` and either the `AWS_*`
+ `SSH_*` vars (AWS path) or the `DB_*` + `SSH_*` vars (direct path), then run the
suite normally. See each layer's `.env.example` for the full variable list.

> The reporters match `TC-<AREA>-###` ids in test titles. The private
> `@test/integrations` package (AWS CQM path) is an `optionalDependency`; provide
> its registry token via `VD_NPM_TOKEN` — never commit a token to `.npmrc`.

## Layer conventions followed

- `.claude/rules/api-automation.rules.md` — clients/payloads/schemas/utils separation, response-time SLA helper, request-echo assertion helper, TC-ID in test titles.
- `.claude/rules/automation-architecture.rules.md` — Type/Module/Feature layout, no hardcoded selectors/URLs.
- `.claude/rules/secrets-and-env.rules.md` — zero literals; `.env.example` committed, `.env` git-ignored.
- `.claude/agents/api-automation-ts.md` — canonical layout (`src/config`, `src/clients`, `src/payloads`, `src/schemas`, `src/utils`, `tests/`), `strict: true` tsconfig, Zod-first schema validation.
