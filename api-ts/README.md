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

## Run by spec (feature)

Runs every test file that belongs to one **feature spec**
(`documents/input/SPEC_CEIQ-*.md`) — regardless of filename. Each test file names
its owning spec in its header comment; [`scripts/run-by-spec.mjs`](scripts/run-by-spec.mjs)
reads that code and runs Vitest against exactly the matching files. This is the
run-side twin of the **Spec** filter in the HTML report: run one spec here → the
report shows that one spec.

```bash
# <env> then <feature>. The feature token is tolerant — all of these mean CEIQ-FEAT-004:
npm run test:spec -- dev FEAT-004
npm run test:spec -- dev CEIQ-FEAT-004
npm run test:spec -- dev 004

# Identity / RBAC / Audit foundation (8 files) on local:
npm run test:spec -- local FOUND-001

# List the available specs (run with no feature):
npm run test:spec -- dev

# Extra Vitest flags go after the feature:
npm run test:spec -- dev FEAT-003 -t "TC-UMAPI-001" --reporter=verbose
```

| Feature spec        | Title                     |
| ------------------- | ------------------------- |
| **CEIQ-FEAT-001**   | Admin Portal              |
| **CEIQ-FEAT-002**   | User Authentication       |
| **CEIQ-FEAT-003**   | User Management           |
| **CEIQ-FEAT-004**   | Company Settings          |
| **CEIQ-FOUND-001**  | Identity, RBAC & Audit    |

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

## Run by suite (Regression / Smoke)

Tests carry suite tags in their titles, selected with Vitest's `-t` name filter:

- **`@regression`** — tests that **run on the dev/live target**: plain `test()`
  (env-agnostic) and `liveOnly()` (dev/live). **Local-only** cases are *not* tagged —
  `localOnly` / `dbOnly` (need the Docker Postgres + JWKS mock) and
  `test.skipIf(isLiveEnv())` (locally-signed JWT) skip on dev, so they are excluded
  from the regression suite. `test.skip` scaffolds and under-development specs are
  never tagged either.
- **`@smoke`** — the ~20% highest-priority regression cases **per spec** (core contract
  + key auth/security). Every `@smoke` test is **also** `@regression` and dev-runnable.

> **Zero-skip runs.** Every case is declared through a runner in
> [`src/utils/suite.ts`](src/utils/suite.ts) (`test`, `localOnly`, `dbOnly`, `liveOnly`,
> `deferred`) that decides at registration time whether to register, skip, or drop it:
> - `test:regression*` sets `REGRESSION_ONLY=1` → cases that can't run on the target are
>   **dropped** (not registered) instead of shown as `test.skip`.
> - `test:smoke*` sets `SMOKE_ONLY=1` → additionally, any case whose title lacks `@smoke`
>   is **dropped**, so only the smoke set is collected.
>
> So `npm run test:regression:dev` (119 cases) and `npm run test:smoke:dev` (24 cases)
> both report **zero skipped**. Normal runs (`test:dev`, `test:local`, …) are unchanged —
> env-gated cases stay visible as *skipped* for traceability. Run the local-only set with
> `npm run test:local` (Docker backend), where `localOnly`/`dbOnly` execute.

```bash
npm run test:regression       # full regression suite (all running tests)
npm run test:smoke            # smoke only — 20% high-priority subset
npm run test:regression:dev   # regression on dev (cross-env TEST_ENV=dev)
npm run test:smoke:dev        # smoke on dev
```

Because smoke titles carry **both** tags, a regression run includes the smoke set;
a smoke run runs the subset only. Combine with any env or filter (flags after `--`):

```bash
npm run test:qa -- -t @regression         # regression on qa
npm run test:dev -- admin -t @smoke        # smoke, admin specs only, on dev
```

> **Tagging a new test:** append ` @regression` only to a **dev-runnable** test —
> plain `test()` or `liveOnly()` (and ` @smoke` if it's a per-spec priority case,
> keeping ~20%). Do **not** tag local-only (`localOnly`/`dbOnly`/`test.skipIf`) or
> `test.skip` cases. Easiest: edit the allowlist in
> [`scripts/tag-suites.mjs`](scripts/tag-suites.mjs) and run `node scripts/tag-suites.mjs`
> to re-apply/audit every tag in bulk (idempotent).

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
