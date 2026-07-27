# ClearEdgeIQ API automation — skipped-test walkthrough (QA → Dev)

_Prepared for the backend dev in response to "walk me through the automation flow and blockers." Generated 2026-07-24 from `clearedgeiq-testcase` (`automation/api-ts` + `automation/frontend`), verified against live dev (`https://d1nbz9zkjf6uqs.cloudfront.net`)._

Your read is correct: **no single environment has both real Cognito and DB/test-data access.** That is the root cause of most skips — but not all of them, and a few are actually un-skippable from the **automation side today**. This document breaks down exactly which is which so we can split the work.

---

## 1. The root cause in one table — environment capability matrix

Every skip traces back to a missing cell here.

| Capability | `local` (Dockerised backend) | `dev` (CloudFront deploy) | What needs it |
|---|---|---|---|
| Real Cognito (mint real tokens) | ❌ (JWKS **mock** only) | ✅ **admin pool**; tenant pool exists, PO user seeded | any real-token flow |
| Forge invalid/edge JWTs (own signing key) | ✅ mock key | ❌ | expired / wrong-issuer / missing-claim token tests |
| Direct DB read (`TEST_DATABASE_URL`) | ✅ | ❌ (RDS unreachable) | assert audit rows, password-at-rest, transactional integrity |
| A **second** tenant + known cross-tenant email | ❌ | ❌ | cross-tenant email-clash tests |
| The PO's **own** user id exposed via API | n/a | ❌ (list excludes self; `management-home` has no id) | self-modification-forbidden tests |

`local` = DB + forge-any-token, **no** real Cognito. `dev` = real Cognito, **no** DB, **no** forging. Neither has both → the ~17 API skips.

---

## 2. How the suites are set up (the automation flow)

**One env accessor** (`api-ts/src/config/env.ts`) drives everything via `TEST_ENV` (`local`|`dev`|`qa`|`prod`), which loads `envs/.env.<env>`. Key gates:

- `isLiveEnv()` → true for dev/qa/prod (real Cognito, no forged tokens).
- `hasDbAccess()` → true only when `TEST_DATABASE_URL` is set (local only).
- `hasLiveTenantUser()` → true when `DEV_TENANT_USERNAME/PASSWORD` are set (**they are, on dev**).

**Token flow:**
- **local** — a JWKS mock signs forged tokens with any claims; a DB fixture backs the principal.
- **dev** — tokens are minted via real Cognito `InitiateAuth`, exactly like the SPA: admin ID token from `DEV_ADMIN_*`, PO tenant ID token from `DEV_TENANT_*`. No token can be forged.

**Skip idioms you'll see in the specs:**
- `localOnly = isLiveEnv() ? test.skip : test` — needs forged tokens or DB → runs on local only.
- `liveOnly  = isLiveEnv() ? test : test.skip` — needs real Cognito → runs on live only.
- `dbOnly    = hasDbAccess() && !isLiveEnv() ? test : test.skip` — needs DB → local only.
- `test.skipIf(REQUIRES_TENANT_FIXTURE)` — needs a valid tenant-pool principal.
- `maybeDb(fn)` — runs a DB assertion **only** if a DB is configured; **no-ops on dev** (so the test still runs and asserts everything the API exposes; only the internal-state check is skipped).
- hard `test.skip(...)` — genuinely blocked; reason is in the test name.

**Teardown** is API-based (`DELETE /admin/tenants/:id`, which also removes the Cognito owner), so admin-portal create/read/update tests self-clean on dev with no DB.

---

## 3. What already runs on dev vs what's skipped

**Runs green on dev today** (endpoints return 401 unauthenticated = built; probed 2026-07-24): admin-portal tenant **create / list / search / detail / company-update / status** (`/admin/tenants`), user-management **reads** (`/users`, `/users/management-home`), company-settings **reads** (`/company-settings`), and auth **admin-guard/pool-separation** checks. Internal-state assertions inside these are wrapped in `maybeDb()` and simply no-op on dev.

**Not built on dev** (probed → **404**, so their whole specs are skipped and excluded from CI — these are yours to build, no automation blocker): `/tenant/users` (`user.test.ts`), `/tenant/audit-logs` + `/admin/audit-logs` (`audit.test.ts`), `/vendor-portal/session` + `/vendors` (`vendor.test.ts`), and the RBAC feature endpoints (`rbac.test.ts` still targets `/TODO/fixture/*`).

**The 3 report failures are one real backend bug, not an automation issue** — please review:

| Case | Endpoint | Result |
|---|---|---|
| TC-ADMAPI-060 | `POST /admin/tenants/:id/handover` | expected 200, got **500 `ERR_INTERNAL_SERVER_ERROR`** |
| TC-ADMAPI-051 | handover (as fixture step) | fixture handover **HTTP 500** |
| TC-ADMAPI-061 | handover on already-handed-over tenant | fixture handover **HTTP 500** |

Handover is throwing a 500 on dev for every call. That single fix turns 3 red → green and unblocks the handover fixture used by several other cases.

---

## 4. The 22 skips — grouped by blocker, with owner

### Group 1 — Un-skippable from the **automation side now** (QA action, no backend change)
A real PO tenant user **already exists on dev** (`ubaid.rehman+01`), and the **frontend already creates managed users on dev** with the PO's real token (`frontend/utils/appApi.ts` → `POST /v1/users`). The API mutation tests were gated `localOnly` **before** that PO user existed — that gate is now stale.

| Case(s) | Spec | Why it can run now |
|---|---|---|
| UM create/edit/status happy paths (`localOnly`) | `userManagement.test.ts` | mint a real PO tenant token (same as the frontend seeder) and hit the real `/users` |
| TC-AUTH-001 (valid tenant JWT accepted) | `auth.test.ts` | the PO tenant token **is** a valid tenant-pool principal |
| TC-AUTH-007 (tenant token rejected by admin route) | `auth.test.ts` | needs only a real tenant token — now available |
| TC-UMHOME-009 / 010 (pagination) | `user-management-home.spec.ts` | needs pagination page-object methods + the **existing** `AppUserSeeder` (>12 users) — pure QA |
| TC-UMHOME-020 (toast timing) | `user-management-home.spec.ts` | QA-side; better covered in the create spec |

**→ QA owns these.** No backend or infra dependency. We'll wire the PO-token path and pagination page objects.

### Group 2 — Needs test **data provisioning** (collaborative: seed script ± a small backend hook)

| Case(s) | Spec | Data required | Blocker / why automation can't self-serve |
|---|---|---|---|
| TC-UMAPI-033 / 067 / 070 (cross-tenant email clash) | `userManagement.test.ts` | a **known email living in a *second* dev tenant** | our seeder creates users in the PO's *own* tenant; there's no second tenant with a stable known email |
| TC-UMHOME-019 (non-PO redirect) | `user-management-home.spec.ts` | a **Manager/Analyst** login that can authenticate | we can create the user, but need working credentials to log in as non-PO |
| TC-UMAPI-065 / 083 (self-modification → 403) | `userManagement.test.ts` | **the PO's own user id** | **no dev API exposes it** — the list excludes self and `management-home` returns no id |

**→ Split:**
- Cross-tenant + non-PO account → a **seed/bootstrap script** (see §5) can create these via the admin API; mostly QA, needs you only to confirm the second-tenant approach is acceptable on dev.
- Self-modification → **small backend/API gap**: expose the caller's own user id (e.g. include `id` on `/users/management-home`, or return the tenant user id from `/user/me`). Once exposed, we un-skip immediately.

### Group 3 — Needs **DB access or a verification hook** (infra or backend)
These assert **internal state no API exposes**, so on dev they can't be verified at all.

| Case(s) | Spec | Verifies |
|---|---|---|
| TC-ADMAPI-015 | `adminPortal.tenants.test.ts` | setup password stored **encrypted**; audit snapshot strips it |
| TC-ADMAPI-006 | `adminPortal.tenants.test.ts` | every mutating endpoint writes a `platform_audit_logs` row |
| TC-UMAPI-094 | `userManagement.test.ts` | a `tenant_audit_logs` row per mutating endpoint |
| TC-ADMAPI-055 | `adminPortal.owner-handover.test.ts` | missing active PO → 500 generic, **no partial writes** |
| TC-ADMAPI-063 | `adminPortal.owner-handover.test.ts` | old setup password no longer authenticates after handover |
| TC-ADMAPI-066 | `adminPortal.owner-handover.test.ts` | handover invalidates active PO session (global sign-out) |

**→ Two possible unlocks (your call):**
- **(a) Provision a test env with DB read** (isolated/seeded sandbox with both Cognito + DB), or
- **(b) Build the audit-log read endpoints** (`/admin/audit-logs`, `/tenant/audit-logs` — currently 404). Option (b) is a **two-for-one**: it satisfies these audit assertions *and* unblocks the whole `audit.test.ts` suite. 063/066 additionally need re-auth/session-invalidation to be observable, which the auth endpoints already allow once handover works (see the §3 handover 500).

### Group 4 — Needs a **product/PM decision** (confirm, then we assert)

| Case | Question |
|---|---|
| TC-ADMAPI-014-9 | 320-char `ownerEmail` is rejected on dev — what is the **real** max-length cap? |
| TC-AUTH-005 | **Deviation:** code returns `401 ERR_AUTH_INVALID_TOKEN` for a missing `role_id` claim, spec (SR-006) says `403`. Which is correct? |

**→ You/PM confirm; we un-skip against the agreed behaviour.**

### Group 5 — Inherently **local-only**, no dev action (listed for completeness)

| Case(s) | Why |
|---|---|
| TC-AUTH-003 / 004 (wrong-issuer / expired JWT rejected) | a malformed/expired token is **constructible only with the local mock signing key**; you cannot mint an invalid real Cognito token. These stay on `local`. |
| TC-UMHOME-011 (empty-state) | shared dev can't be emptied (seeding has no delete); needs a fresh tenant. |

---

## 5. Bootstrap / seed script — what's needed and why it doesn't exist yet

**What exists today:** ad-hoc seeders — `frontend/utils/adminApi.ts` (creates tenants via admin API) and `frontend/utils/appApi.ts` (creates managed users via the PO token). Both reuse the logged-in SPA's real ID token; no secrets. They create data **but never delete** it (no delete endpoint / not wanted on shared dev).

**What a proper bootstrap script would create (once, idempotent):**
1. A **second dev tenant** with a **known, stable owner email** → unblocks cross-tenant clash (033/067/070).
2. A **Manager and an Analyst** user with usable credentials → unblocks non-PO redirect (019) and future RBAC.
3. (If we go the empty-tenant route) a **fresh disposable tenant** per run → unblocks empty-state (011).

**Why current automation can't just do this inline:**
- **No cleanup path** — there's no user-delete and we won't hard-delete on shared dev, so per-test creation leaks data and can't reset to a known baseline (e.g. empty state).
- **Cross-tenant data is a fixture, not a per-test artifact** — it must pre-exist in a *different* tenant with a *known* email; a test running in the PO's own tenant can't manufacture that.
- **Some values are never exposed** (the PO's own id, audit rows, password-at-rest) — no amount of seeding surfaces them; that's a backend-hook/DB question, not a seeding one.

We're happy to own and write this script; what we need from you is (a) confirmation that a persistent second tenant + Manager/Analyst users on dev is acceptable, and (b) whichever of the small backend hooks below you'd rather build than have us work around.

---

## 6. Decision table — what we need from each side

| # | Blocker | Best fix | Owner |
|---|---|---|---|
| 1 | Handover returns 500 on dev | **Backend bug fix** | Dev |
| 2 | UM mutations / TC-AUTH-001/007 gated `localOnly` | Mint real PO token in api-ts; re-gate to run on dev | **QA** |
| 3 | Pagination cases (UMHOME-009/010) | Add page-object methods + seed >12 users | **QA** |
| 4 | Cross-tenant email clash (033/067/070) | Bootstrap script: 2nd tenant + known email | QA (script) + Dev (confirm approach) |
| 5 | Non-PO redirect (UMHOME-019) | Seed Manager/Analyst + working creds | QA + Dev (confirm) |
| 6 | Self-modification 403 (065/083) | **Expose caller's own user id** via an API | Dev |
| 7 | Audit-row / password-at-rest (015/006/094) | Build `/*/audit-logs` read endpoints **or** provision DB | Dev / DevOps |
| 8 | Handover integrity (055/063/066) | Isolated env w/ DB, or verification hooks (after #1) | DevOps / Dev |
| 9 | Max email cap (014-9), 401-vs-403 (AUTH-005) | Confirm intended behaviour | Dev / PM |
| 10 | Expired/wrong-issuer JWT (003/004) | None — stays local-only | QA (documented) |

**Fastest wins:** #1 (your handover 500 fix → 3 red go green) and #2/#3 (our PO-token + pagination work → several skips go green with no backend change). Those two moves alone clear the biggest chunk. The rest we can schedule against #6/#7 once you decide hook-vs-DB.

---

_Files referenced: `api-ts/src/config/env.ts`, `api-ts/src/clients/controlPlaneClient.ts`, `api-ts/tests/{auth,adminPortal.tenants,adminPortal.owner-handover,userManagement,companySettings}.test.ts`, `frontend/tests/user-management-home.spec.ts`, `frontend/utils/{adminApi,appApi}.ts`, `automation/SKIPPED-TESTS-FOR-DEV.md`._
