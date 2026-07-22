# Frontend Automation — CEIQ-FEAT-001 Admin Portal (Playwright)

UI end-to-end suite for the ClearEdgeIQ Admin Portal. Playwright + TypeScript.
Test specs live in [`tests/`](tests/); each `test()` is tagged with its `TC-ID`
(e.g. `TC-ADMLOGIN-001`) in the title and is traceable via `testcases/TRACEABILITY.md`.

## Prerequisites

```bash
cd automation/frontend
npm install
npx playwright install        # first time only — downloads browsers
```

Environment files select the target: `TEST_ENV` picks `automation/frontend/.env.<env>`
(via [`scripts/run-env.mjs`](scripts/run-env.mjs) → [`utils/env.ts`](utils/env.ts)).
`E2E_BASE_URL` is the **admin** portal URL, `APP_BASE_URL` is the tenant app URL.
There is no localhost fallback — a missing `E2E_BASE_URL` fails the run loudly.

| Env    | File          | Status                          |
| ------ | ------------- | ------------------------------- |
| `dev`  | `.env.dev`    | wired ✅                         |
| `qa`   | `.env.qa`     | pending — copy from `.env.example` |
| `prod` | `.env.prod`   | pending — copy from `.env.example` |
| `local`| `.env.local`  | pending — copy from `.env.example` |

Copy [`.env.example`](.env.example) → `.env.<env>` and fill in real values for
any env not yet wired. `.env*` are git-ignored.

## Run by environment

Each script sets `TEST_ENV`, flushes stale reports, then runs Playwright:

```bash
npm run test:dev      # → .env.dev   (the wired environment today)
npm run test:qa       # → .env.qa
npm run test:prod     # → .env.prod
npm run test:local    # → .env.local

npm test              # runs against whatever .env the config resolves (no TEST_ENV switch)
```

Extra Playwright flags go **after `--`** (forwarded verbatim, cross-platform):

```bash
npm run test:dev -- --headed        # watch it drive a real browser
npm run test:dev -- --ui            # Playwright UI mode (pick/replay tests)
npm run test:dev -- --debug         # step through with the inspector
npm run test:dev -- --workers=1     # override worker count (default is 1)
```

## Run by module (spec file)

The suite is the Admin Portal; each module is one spec file. Playwright treats a
positional argument as a **path substring**, so a keyword runs every matching file.

| Module                     | Spec file                  | User story     |
| -------------------------- | -------------------------- | -------------- |
| Login & session (**admin login**) | `login.spec.ts`     | US-1.1         |
| Setup password & handover  | `setup-handover.spec.ts`   | US-4.1 / US-4.2 |
| Create tenant              | `tenant-create.spec.ts`    | US-3.1         |
| Tenant list                | `tenant-list.spec.ts`      | US-2.1         |
| Tenant profile & edit      | `tenant-edit.spec.ts`      | US-2.3         |
| Active/Inactive toggle     | `tenant-toggle.spec.ts`    | US-2.2         |
| UX states                  | `ux-states.spec.ts`        | §10            |

```bash
# Admin login specs only (the "admin login" module), on dev:
npm run test:dev -- login

# All tenant modules (create + list + edit + toggle — every tenant-*.spec.ts):
npm run test:dev -- tenant

# One specific module by full path:
npm run test:qa -- tests/tenant-list.spec.ts
```

## Run by spec (feature)

Runs every `*.spec.ts` that belongs to one **feature spec**
(`documents/input/SPEC_CEIQ-*.md`) — regardless of filename. Each spec file names
its owning feature in its header comment; [`scripts/run-by-spec.mjs`](scripts/run-by-spec.mjs)
reads that code, flushes reports, sets the env, then runs Playwright against exactly
the matching files. Running one spec yields a report scoped to that one spec, so the
Playwright report reads spec-wise without any extra filtering.

```bash
# <env> then <feature>. The feature token is tolerant — all of these mean CEIQ-FEAT-004:
npm run test:spec -- dev FEAT-004
npm run test:spec -- dev CEIQ-FEAT-004
npm run test:spec -- dev 004

# List the available specs (run with no feature):
npm run test:spec -- dev

# Extra Playwright flags go after the feature:
npm run test:spec -- dev FEAT-003 --headed
npm run test:spec -- qa FEAT-001 -g "TC-ADMLIST-001"
```

| Feature spec       | Title            | Spec files                          |
| ------------------ | ---------------- | ----------------------------------- |
| **CEIQ-FEAT-001**  | Admin Portal     | `login`, `tenant-*`, `ux-states`, `setup-handover` |
| **CEIQ-FEAT-003**  | User Management  | `user-management-*`                 |
| **CEIQ-FEAT-004**  | Company Settings | `company-settings-*`                |

## Run by test case (TC-ID / title)

`-g` (grep) filters by test **title**, which contains the `TC-ID`:

```bash
npm run test:dev -- -g "TC-ADMLOGIN-001"          # one case
npm run test:dev -- -g "TC-ADMLOGIN"              # all admin-login cases
npm run test:dev -- -g "TC-ADMCREATE|TC-ADMLIST"  # multiple case groups (regex)
```

Combine env + module + grep freely:

```bash
npm run test:qa -- tests/login.spec.ts -g "TC-ADMLOGIN-003"
```

## Reports

- HTML dashboard: `automation/reports/playwright-html/index.html` (open after a run).
- JSON summary: `reports/last-run.json`.
- Failure evidence (trace / screenshot / video) is retained under `test-results/`.

Reports are flushed at the start of every `test:*` script, so they always reflect
the latest run.

## TestRail & CQM (opt-in)

Result publishing is off unless flagged — see the root
[`automation/README.md`](../README.md) "TestRail & CQM integration" section.
Reporters are appended only when `TESTRAIL_INTEGRATION=1` / `CQM_INTEGRATION=1`.

```bash
npm run testrail:create-run     # create a TestRail run from mapped TC-ids
npm run testrail:execute        # run the suite and publish results
```
