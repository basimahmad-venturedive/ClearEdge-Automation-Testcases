# API Automation — ClearEdgeIQ (Vitest)

Backend API suite (TypeScript + Vitest + axios + Zod). Per the project stack
directive, API automation on ClearEdge is **always TypeScript, never Python**.
Test specs live in [`tests/`](tests/); each test is tagged with its `TC-ID`
(e.g. `TC-ADMAPI-001`) in the title and is traceable via `testcases/TRACEABILITY.md`.

## Prerequisites

```bash
cd automation/api-ts
npm install
npx tsc --noEmit        # strict type-check, zero errors
```

`TEST_ENV` selects `envs/.env.<env>` (via `cross-env` in the `test:*` scripts).
Copy the matching `envs/.env.<env>.example` → `envs/.env.<env>` and fill in real
values. `API_BASE_URL` is required and fails loud when missing — no localhost
fallback. `.env*` files are git-ignored.

Running against the **local Docker backend** additionally requires the JWKS mock
and `LOCAL_COGNITO_HOST` — see the root [`automation/README.md`](../README.md)
"Test execution — against the local Docker backend" section for the full bring-up.

## Run by environment

```bash
npm run test:local    # → envs/.env.local  (Docker backend; see note above)
npm run test:dev      # → envs/.env.dev
npm run test:qa       # → envs/.env.qa
npm run test:prod     # → envs/.env.prod

npm test              # default: vitest run (no TEST_ENV switch)
npm run test:watch    # re-run on change
npm run test:coverage # vitest run --coverage
npm run test:live     # USE_MOCK=0 — hit the real backend instead of nock mocks
```

Extra Vitest flags go **after `--`**:

```bash
npm run test:dev -- --reporter=verbose
npm run test:dev -- --bail=1
```

Local Docker run (mint token `iss` must match the app's issuer):

```bash
# bash
LOCAL_COGNITO_HOST=host.docker.internal npm run test:local
```
```powershell
# PowerShell
$env:LOCAL_COGNITO_HOST='host.docker.internal'; npm run test:local
```

## Run by module (spec file)

Vitest treats a positional argument as a **filename filter**, so a keyword runs
every matching file.

| Module            | File(s)                                                                   | Filter keyword |
| ----------------- | ------------------------------------------------------------------------- | -------------- |
| **Admin portal**  | `admin.test.ts`, `adminPortal.owner-handover.test.ts`, `adminPortal.tenants.test.ts` | `admin`        |
| Auth              | `auth.test.ts`, `auth.forgot-refresh-logout.test.ts`, `auth.login-setpw.test.ts`     | `auth`         |
| Tenant            | `tenant.test.ts`                                                          | `tenant.test`  |
| User              | `user.test.ts`                                                            | `user`         |
| Vendor            | `vendor.test.ts`                                                          | `vendor`       |
| Audit             | `audit.test.ts`                                                           | `audit`        |
| Cache (Redis)     | `cache.test.ts`                                                           | `cache`        |
| RBAC              | `rbac.test.ts`                                                            | `rbac`         |

```bash
# Admin specs only (admin.test.ts + both adminPortal.*.test.ts), on dev:
npm run test:dev -- admin

# All auth specs on qa:
npm run test:qa -- auth

# One specific file:
npm run test:dev -- tests/tenant.test.ts
```

> `tenant` matches both `tenant.test.ts` and `adminPortal.tenants.test.ts`. Use
> `tenant.test` (or the full path) to target the standalone tenant module only.

## Run by test case (TC-ID / title)

`-t` filters by test **name** (title contains the `TC-ID`):

```bash
npm run test:dev -- -t "TC-ADMAPI-001"      # one case
npm run test:dev -- -t "TC-ADMAPI"          # all admin-API cases
```

Combine env + module + name filter:

```bash
npm run test:dev -- admin -t "TC-ADMAPI-010"
```

## Reports

- HTML dashboard (ExtentReports-style): `automation/reports/html/api/latest.html` —
  overwritten every run, always the latest execution.
- JUnit XML: `automation/reports/api-ts-junit.xml`.
- Coverage (with `test:coverage`): `./coverage/`.

## TestRail & CQM (opt-in)

Result publishing is off unless flagged — see the root
[`automation/README.md`](../README.md) "TestRail & CQM integration" section.

```bash
npm run testrail:create-run     # create a TestRail run from mapped TC-ids
npm run testrail:execute        # run the suite and publish results
```
