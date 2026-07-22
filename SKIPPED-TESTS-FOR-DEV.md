# Skipped test cases in DEVELOPED specs — for dev/DevOps action

Generated 2026-07-22 · ClearEdgeIQ automation (`clearedgeiq-testcase`)

Under-development specs (feature/screen not built) have been **removed from GitHub**
so CI no longer publishes a wall of skipped results — see
[`.gitignore`](.gitignore) "Under-development test files" block.

The tests below are **different**: their feature/route/screen **is built**, so the
specs stay on GitHub and run in CI, but a handful of cases are still `skip`ped
because of a **test-environment / data / product gap — not a missing feature**.
Share this so each one can be unblocked and un-skipped.

**Totals:** api-ts 17 · frontend 5 · **22 remaining skips.**

---

## What each needs (grouped by blocker)

### A. Needs a test env with BOTH real Cognito *and* direct DB access
*No env has both today: `local` = DB only, `dev` = Cognito only (admin-only, no DB).*
**Owner: DevOps/QA-infra** — provision an isolated env (or seeded sandbox) that has both.

| Case | Spec | What it verifies |
|---|---|---|
| TC-ADMAPI-055 | `api-ts/tests/adminPortal.owner-handover.test.ts` | missing active PO → 500 generic error, no partial writes (isolated/local env only, never shared QA data) |
| TC-ADMAPI-063 | `api-ts/tests/adminPortal.owner-handover.test.ts` | old setup password no longer authenticates after handover |
| TC-ADMAPI-066 | `api-ts/tests/adminPortal.owner-handover.test.ts` | handover invalidates any active PO session token (global sign-out) |

### B. DB-only assertions — internal state not exposed via any API
**Owner: QA-infra (needs DB read in the test env) or dev (expose a verification hook).**

| Case | Spec | What it verifies |
|---|---|---|
| TC-ADMAPI-015 | `api-ts/tests/adminPortal.tenants.test.ts` | setup password stored encrypted; audit snapshot strips it |
| TC-ADMAPI-006 | `api-ts/tests/adminPortal.tenants.test.ts` | every mutating endpoint writes a `platform_audit_logs` row (no `setup_password_enc` in snapshots) |

### C. Needs a Cognito tenant-pool test sandbox / users seeded in a second tenant
*POST/PATCH hit the real Cognito Admin API; `dev` is admin-only with no tenant-pool sandbox.*
**Owner: DevOps/dev** — stand up a Cognito tenant-pool test sandbox and/or seed a second dev tenant + expose the PO's own user id.

| Case | Spec | What it verifies |
|---|---|---|
| TC-AUTH-001 | `api-ts/tests/auth.test.ts` | valid tenant-pool JWT accepted; principal populated (SR-001) |
| TC-AUTH-003 | `api-ts/tests/auth.test.ts` | invalid JWT (wrong_issuer) rejected 401 (constructible only with local mock key) |
| TC-AUTH-004 | `api-ts/tests/auth.test.ts` | invalid JWT (expired) rejected 401 (constructible only with local mock key) |
| TC-AUTH-007 | `api-ts/tests/auth.test.ts` | tenant-pool token rejected by admin-portal route (§7.1 pool separation) |
| TC-UMAPI-033 | `api-ts/tests/userManagement.test.ts` | cross-tenant email clash → 409 (needs a known email in another dev tenant) |
| TC-UMAPI-065 | `api-ts/tests/userManagement.test.ts` | self-modification → 403 (PO's own user id not exposed via any dev API) |
| TC-UMAPI-067 | `api-ts/tests/userManagement.test.ts` | edit cross-tenant email clash → 409 (needs an email in another dev tenant) |
| TC-UMAPI-070 | `api-ts/tests/userManagement.test.ts` | Cognito-first ordering: Cognito failure aborts before any DB write |
| TC-UMAPI-083 | `api-ts/tests/userManagement.test.ts` | status self-modification → 403 (PO's own user id not exposed) |
| TC-UMAPI-094 | `api-ts/tests/userManagement.test.ts` | audit log: a `tenant_audit_logs` row per mutating endpoint |

### D. ⚠️ Needs a product/PM decision or is a spec deviation — **dev/PM please confirm**
| Case | Spec | Question |
|---|---|---|
| TC-ADMAPI-014-9 | `api-ts/tests/adminPortal.tenants.test.ts` | 320-char `ownerEmail` is rejected on dev — **confirm the real max-length cap with PM** before we assert it |
| TC-AUTH-005 | `api-ts/tests/auth.test.ts` | **DEVIATION FOUND:** real code returns `401 ERR_AUTH_INVALID_TOKEN` for a missing `role_id` claim, but the spec (SR-006) says `403`. Dev/PM: confirm which is correct, then we un-skip against the agreed behaviour |

### E. QA test-infra / fixtures (QA-side — no dev action)
*Listed for completeness; QA will unblock these.*

| Case | Spec | Needs |
|---|---|---|
| TC-UMHOME-009 | `frontend/tests/user-management-home.spec.ts` | pagination page-object methods (goToPage/active-page) + >12 users seeded |
| TC-UMHOME-010 | `frontend/tests/user-management-home.spec.ts` | pagination page-object methods + 13 users seeded under one prefix |
| TC-UMHOME-011 | `frontend/tests/user-management-home.spec.ts` | isolated/fresh tenant — shared dev can't be emptied (seeding has no delete); cf. TC-ADMLIST-007 |
| TC-UMHOME-019 | `frontend/tests/user-management-home.spec.ts` | a Manager/Analyst (non-PO) account to verify the redirect |
| TC-UMHOME-020 | `frontend/tests/user-management-home.spec.ts` | a success action + clock control (better covered in the create spec) |

---

## Under-development specs removed from GitHub (context)
These have **zero runnable cases** (every case `skip`ped, feature not built). They stay on
disk but are untracked + runner-excluded, and return automatically once their line is
removed from `.gitignore` + the runner exclude list and they're `git add`ed.

- **api-ts (9):** `admin`, `audit`, `auth.forgot-refresh-logout`, `auth.login-setpw`, `cache`, `rbac`, `tenant`, `user`, `vendor`
- **frontend (7):** `company-settings-access/edit/view`, `user-management-create/edit/email/status`
