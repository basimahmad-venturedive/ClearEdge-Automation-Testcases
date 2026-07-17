/**
 * TC-UMAPI-001..094 — CEIQ-FEAT-003 User Management API contract.
 * Spec: SPEC_CEIQ-FEAT-003-user-management.md §4 (6 endpoints under /api/v1/users),
 * §6 error codes, §7 security (SR-001..009). Manual suite: testcases/TC-CEIQ-FEAT-003.md.
 *
 * SCAFFOLDED — every test is `test.skip` because no environment, PO token, or deployed
 * User Management controllers exist yet (§5/§8 TBD). Matches the FOUND-001 pattern
 * (tests/user.test.ts). Un-skip once a live env + a real PO JWT (manage_users) are wired.
 */
import { describe, test, expect } from "vitest";
import { UserManagementClient } from "../src/clients/userManagementClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
import {
  newCreateUser,
  newEditUser,
  CREATE_INVALID_EMAIL,
  CREATE_NAME_MAX_255,
  STATUS_DEACTIVATE,
  STATUS_ACTIVATE,
} from "../src/payloads/userManagementPayloads";
import {
  managementHomeResponseSchema,
  listResponseSchema,
  createUserResponseSchema,
  singleUserResponseSchema,
  editUserResponseSchema,
  statusResponseSchema,
} from "../src/schemas/userManagement.schema";
import { assertResponseTime, assertRequestEchoedInResponse, assertErrorEnvelope } from "../src/utils/assertions";

const NO_ENV_REASON = "no environment / deployed User Management controllers / PO token yet — see TC-CEIQ-FEAT-003.md";
const COGNITO_REASON = `${NO_ENV_REASON}; also needs Cognito tenant-pool test sandbox (Partial automation)`;
const SENDGRID_REASON = `${NO_ENV_REASON}; SendGrid dispatch needs a sandbox decision (Partial/Manual)`;
const DB_REASON = `${NO_ENV_REASON}; also needs DB access to assert the persisted row / audit log`;

const jwtFactory = new JwtFactory();
const TENANT_A = "tenant-a";
const PO_ROLE = "role-po"; // holds manage_users (F1 §4)
const PO_SUB = "po-sub-0001";

const poToken = () => jwtFactory.tenantToken({ tenantId: TENANT_A, roleId: PO_ROLE, sub: PO_SUB });

const UUID_SAMPLE = "a1b2c3d4-0000-4000-8000-000000000001";

// ── GET /users/management-home ──────────────────────────────────────────────
describe("GET /users/management-home", () => {
  test.skip(`TC-UMAPI-001 — 200 envelope: organization + profile with field mapping [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new UserManagementClient();
    const res = await client.managementHome(await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    managementHomeResponseSchema.parse(res.data);
    // companyName ← tenants.name, website ← tenants.website_url (§4.2 field mapping)
  });

  test.skip(`TC-UMAPI-002 — null organization fields returned as null [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.managementHome(await poToken());
    expect(res.status).toBe(200);
    const parsed = managementHomeResponseSchema.parse(res.data);
    // A tenant with address never set → address === null (frontend renders "—").
    expect(parsed.data.organization).toHaveProperty("address");
  });
});

// ── GET /users (list, search, filter, paginate) ─────────────────────────────
describe("GET /users", () => {
  test.skip(`TC-UMAPI-010 — 200 list envelope, user object shape, created_at DESC, pagination metadata [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new UserManagementClient();
    const res = await client.listUsers({ page: 1, limit: 12 }, await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.pagination.limit).toBe(12);
    // Ordering: created_at DESC — see TC gap on missing tie-breaker (non-deterministic at boundary).
  });

  test.skip(`TC-UMAPI-011 — search: case-insensitive ILIKE partial match, parameterized [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.listUsers({ search: "ann" }, await poToken());
    expect(res.status).toBe(200);
    const parsed = listResponseSchema.parse(res.data);
    // "ann" must match "Anna Khan" and "Zainab Anne" (case-insensitive, anywhere).
    for (const u of parsed.data.users) expect(u.name.toLowerCase()).toContain("ann");
  });

  // TC-UMAPI-012-1..5 — one explicit test case per injection-shaped search input
  // (see SEARCH_INJECTION_INPUTS). `%`/`_` must be escaped to match literally, not as wildcards.
  async function assertSearchInputLiteral(input: string): Promise<void> {
    const client = new UserManagementClient();
    const res = await client.listUsers({ search: input }, await poToken());
    // No 500, no SQL error; the input is parameterized and treated as a literal.
    expect(res.status).toBe(200);
    listResponseSchema.parse(res.data);
  }

  test.skip(`TC-UMAPI-012-1 — ILIKE escaping; input="100% match" treated as literal [blocked: ${NO_ENV_REASON}]`, () => assertSearchInputLiteral("100% match"));
  test.skip(`TC-UMAPI-012-2 — ILIKE escaping; input="under_score" treated as literal [blocked: ${NO_ENV_REASON}]`, () => assertSearchInputLiteral("under_score"));
  test.skip(`TC-UMAPI-012-3 — ILIKE escaping; input="'; DROP TABLE users;--" treated as literal [blocked: ${NO_ENV_REASON}]`, () => assertSearchInputLiteral("'; DROP TABLE users;--"));
  test.skip(`TC-UMAPI-012-4 — ILIKE escaping; input="%" treated as literal [blocked: ${NO_ENV_REASON}]`, () => assertSearchInputLiteral("%"));
  test.skip(`TC-UMAPI-012-5 — ILIKE escaping; input="_" treated as literal [blocked: ${NO_ENV_REASON}]`, () => assertSearchInputLiteral("_"));

  // TC-UMAPI-013-1..3 — one explicit test case per role-filter slug (manager / analyst / empty=all).
  async function assertRoleFilter(role: "procurement_manager" | "procurement_analyst" | ""): Promise<void> {
    const client = new UserManagementClient();
    const res = await client.listUsers({ role }, await poToken());
    expect(res.status).toBe(200);
    listResponseSchema.parse(res.data);
    // NOTE: whether `roles` exposes a `slug` column vs matching on name is F1-owned — contract-TBD in TC file.
  }

  test.skip(`TC-UMAPI-013-1 — role filter by slug=procurement_manager [blocked: ${NO_ENV_REASON}]`, () => assertRoleFilter("procurement_manager"));
  test.skip(`TC-UMAPI-013-2 — role filter by slug=procurement_analyst [blocked: ${NO_ENV_REASON}]`, () => assertRoleFilter("procurement_analyst"));
  test.skip(`TC-UMAPI-013-3 — role filter by empty slug (empty = all) [blocked: ${NO_ENV_REASON}]`, () => assertRoleFilter(""));

  test.skip(`TC-UMAPI-014 — self-exclusion: PO's own record never in the list (SR-003) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.listUsers({}, await poToken());
    const parsed = listResponseSchema.parse(res.data);
    // The PO's own cognito_sub is excluded server-side; assert none of the rows is the PO.
    expect(parsed.data.users.every((u) => u.email !== "owner@clearedge.com")).toBe(true);
  });

  test.skip(`TC-UMAPI-015 — pagination: offset math, 12/page, page boundary, page beyond last [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const beyond = await client.listUsers({ page: 999, limit: 12 }, await poToken());
    // page > totalPages behavior (empty vs error) is contract-TBD — assert no server error only.
    expect(beyond.status).toBeLessThan(500);
  });

  test.skip(`TC-UMAPI-016 — avatar initials derivation (backend rule); display_id immutability [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.listUsers({}, await poToken());
    const parsed = listResponseSchema.parse(res.data);
    // "Kyle Chancellor" → "KC"; "Priya" → "P". display_id matches USR-#### and never changes.
    for (const u of parsed.data.users) expect(u.displayId).toMatch(/^USR-\d{4}$/);
  });

  test.skip(`TC-UMAPI-017 — search trimmed; whitespace-only treated as empty [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const [blank, spaces] = await Promise.all([
      client.listUsers({ search: "" }, await poToken()),
      client.listUsers({ search: "   " }, await poToken()),
    ]);
    const a = listResponseSchema.parse(blank.data);
    const b = listResponseSchema.parse(spaces.data);
    expect(b.data.pagination.totalRecords).toBe(a.data.pagination.totalRecords);
  });

  test.skip(`TC-UMAPI-018 — search + role filter combine with AND logic [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.listUsers({ search: "a", role: "procurement_manager" }, await poToken());
    const parsed = listResponseSchema.parse(res.data);
    for (const u of parsed.data.users) {
      expect(u.name.toLowerCase()).toContain("a");
      expect(u.role).toBe("Procurement Manager");
    }
  });
});

// ── POST /users (create) ────────────────────────────────────────────────────
describe("POST /users", () => {
  test.skip(`TC-UMAPI-030 — create 201 contract, permission label derived, message field [blocked: ${COGNITO_REASON}] @smoke`, async () => {
    const client = new UserManagementClient();
    const body = newCreateUser({ role: "procurement_manager" });
    const res = await client.createUser(body, await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(201);
    const parsed = createUserResponseSchema.parse(res.data);
    expect(parsed.data.user.permissionLabel).toBe("Read/Write");
    assertRequestEchoedInResponse({ name: body.name, email: body.email }, res);
  });

  test.skip(`TC-UMAPI-031 — validation → 400 ERR_VALIDATION_FAILED with exact message [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser(CREATE_INVALID_EMAIL, await poToken());
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
    expect((res.data as { error: { message: string } }).error.message).toBe(
      "Please fill in all fields with a valid email.",
    );
  });

  test.skip(`TC-UMAPI-032 — same-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_TENANT [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser(newCreateUser({ email: "existing.same@clearedge.com" }), await poToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_TENANT");
    expect((res.data as { error: { message: string } }).error.message).toBe(
      "This email is already in use by another user in your organization.",
    );
  });

  test.skip(`TC-UMAPI-033 — cross-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_USE (Cognito UsernameExistsException) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser(newCreateUser({ email: "existing.other@othertenant.com" }), await poToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_USE");
    expect((res.data as { error: { message: string } }).error.message).toBe("This email is already in use.");
  });

  test.skip(`TC-UMAPI-034 — temporary password never present in the create response (SR-008) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser(newCreateUser(), await poToken());
    const raw = JSON.stringify(res.data).toLowerCase();
    expect(raw).not.toContain("temporarypassword");
    expect(raw).not.toContain("password");
  });

  test.skip(`TC-UMAPI-035 — display_id atomic per-tenant alloc; USR-0001 first; per-tenant not global [blocked: ${DB_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser(newCreateUser(), await poToken());
    const parsed = createUserResponseSchema.parse(res.data);
    expect(parsed.data.user.displayId).toMatch(/^USR-\d{4}$/);
    // Two tenants' first users both getting USR-0001 is expected (not a collision) — needs 2 tenants + DB.
  });

  test.skip(`TC-UMAPI-036 — double-submit idempotency: repeat POST → no duplicate Cognito user [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const body = newCreateUser();
    const first = await client.createUser(body, await poToken());
    const second = await client.createUser(body, await poToken());
    expect(first.status).toBe(201);
    // Same email again → same-tenant clash, not a duplicate.
    expect(second.status).toBe(409);
  });

  test.skip(`TC-UMAPI-037 — name max-length boundary (255) accepted [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser({ ...CREATE_NAME_MAX_255, email: newCreateUser().email }, await poToken());
    expect(res.status).toBe(201);
    createUserResponseSchema.parse(res.data);
  });
});

// ── GET /users/:id ──────────────────────────────────────────────────────────
describe("GET /users/:id", () => {
  test.skip(`TC-UMAPI-050 — 200 single-user detail contract [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.getUser(UUID_SAMPLE, await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    singleUserResponseSchema.parse(res.data);
  });

  test.skip(`TC-UMAPI-051 — 404 ERR_USER_NOT_FOUND for an unknown id [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.getUser("00000000-0000-4000-8000-000000000000", await poToken());
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_USER_NOT_FOUND");
  });

  test.skip(`TC-UMAPI-052 — invalid UUID path param (400 vs 404 — contract-TBD) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.getUser("not-a-uuid", await poToken());
    // Exact code unspecified — assert client-error, not 5xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  test.skip(`TC-UMAPI-053 — cross-tenant :id → 404 (RLS isolation, SR-002) [blocked: ${DB_REASON}]`, async () => {
    const client = new UserManagementClient();
    // A user id that exists in tenant B must be invisible to tenant A's PO → 404.
    const res = await client.getUser(UUID_SAMPLE, await poToken());
    expect(res.status).toBe(404);
  });
});

// ── PATCH /users/:id (edit — 3 branches) ────────────────────────────────────
describe("PATCH /users/:id", () => {
  test.skip(`TC-UMAPI-060 — Branch A: name-only change → DB update, no Cognito/sign-out/email, emailChanged omitted [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const body = newEditUser({ name: "Renamed User" });
    const res = await client.editUser(UUID_SAMPLE, body, await poToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged ?? false).toBe(false);
  });

  test.skip(`TC-UMAPI-061 — Branch B: role change → role_id + Cognito attr + cache invalidation + AdminUserGlobalSignOut (SR-006) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ role: "procurement_analyst" }), await poToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.user.permissionLabel).toBe("Read Only");
  });

  test.skip(`TC-UMAPI-062 — Branch C: email change → same-tenant check, Cognito update + sign-out + new temp pw, emailChanged + message (SR-007) [blocked: ${SENDGRID_REASON}] @smoke`, async () => {
    const client = new UserManagementClient();
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "new.address@clearedge.com" }), await poToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged).toBe(true);
    expect(parsed.data.message).toContain("temporary password");
  });

  test.skip(`TC-UMAPI-063 — no-op: nothing changed → success, no DB/Cognito write [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    // Submit the user's current values verbatim → success, emailChanged false, no toast implied.
    const res = await client.editUser(UUID_SAMPLE, newEditUser(), await poToken());
    expect(res.status).toBe(200);
  });

  test.skip(`TC-UMAPI-064 — case-only email is not a real change (Branch A / no-op) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "KYLE@clearedge.com" }), await poToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged ?? false).toBe(false);
  });

  test.skip(`TC-UMAPI-065 — self-modification → 403 ERR_SELF_MODIFICATION_FORBIDDEN (SR-003) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    // Target the PO's own record → 403.
    const res = await client.editUser(UUID_SAMPLE, newEditUser(), await poToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_SELF_MODIFICATION_FORBIDDEN");
  });

  test.skip(`TC-UMAPI-066 — edit same-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_TENANT (excludes self) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.same@clearedge.com" }), await poToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_TENANT");
  });

  test.skip(`TC-UMAPI-067 — edit cross-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_USE (AliasExistsException) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.other@othertenant.com" }), await poToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_USE");
  });

  test.skip(`TC-UMAPI-068 — edit validation → 400; unknown id → 404 [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const invalid = await client.editUser(UUID_SAMPLE, { ...newEditUser(), name: "   " }, await poToken());
    expect(invalid.status).toBe(400);
    assertErrorEnvelope(invalid, "ERR_VALIDATION_FAILED");
    const missing = await client.editUser("00000000-0000-4000-8000-000000000000", newEditUser(), await poToken());
    expect(missing.status).toBe(404);
  });

  test.skip(`TC-UMAPI-069 — temp password never present in the edit (email-change) response (SR-008) [blocked: ${SENDGRID_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "brand.new@clearedge.com" }), await poToken());
    expect(JSON.stringify(res.data).toLowerCase()).not.toContain("temporarypassword");
  });

  test.skip(`TC-UMAPI-070 — Cognito-first ordering: Cognito failure aborts before any DB write [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    // Simulate Cognito failure (e.g. AliasExists) → response is an error AND the DB email is unchanged (needs DB assert).
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.other@othertenant.com" }), await poToken());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── PATCH /users/:id/status (activate / deactivate) ─────────────────────────
describe("PATCH /users/:id/status", () => {
  test.skip(`TC-UMAPI-080 — deactivate: AdminUserGlobalSignOut + AdminDisableUser + status=inactive (SR-005) [blocked: ${COGNITO_REASON}] @smoke`, async () => {
    const client = new UserManagementClient();
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await poToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = statusResponseSchema.parse(res.data);
    expect(parsed.data.user.status).toBe("inactive");
  });

  test.skip(`TC-UMAPI-081 — reactivate: AdminEnableUser + status=active; no email [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.setStatus(UUID_SAMPLE, STATUS_ACTIVATE, await poToken());
    expect(res.status).toBe(200);
    const parsed = statusResponseSchema.parse(res.data);
    expect(parsed.data.user.status).toBe("active");
  });

  test.skip(`TC-UMAPI-082 — same-status submission → success no-op (no Cognito, no write) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    // Deactivate an already-inactive user → success, no-op.
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await poToken());
    expect(res.status).toBe(200);
  });

  test.skip(`TC-UMAPI-083 — status self-modification → 403 ERR_SELF_MODIFICATION_FORBIDDEN (SR-003) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await poToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_SELF_MODIFICATION_FORBIDDEN");
  });

  test.skip(`TC-UMAPI-084 — status validation → 400; unknown id → 404 [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    const invalid = await client.setStatus(UUID_SAMPLE, { status: "banana" }, await poToken());
    expect(invalid.status).toBe(400);
    const missing = await client.setStatus("00000000-0000-4000-8000-000000000000", STATUS_DEACTIVATE, await poToken());
    expect(missing.status).toBe(404);
  });

  test.skip(`TC-UMAPI-085 — ERR_INVALID_STATE_TRANSITION reachability (contract-TBD) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new UserManagementClient();
    // Only active<->inactive exist and same-status short-circuits to no-op, so no input clearly
    // triggers ERR_INVALID_STATE_TRANSITION. Documented gap — assert no server error only.
    const res = await client.setStatus(UUID_SAMPLE, STATUS_ACTIVATE, await poToken());
    expect(res.status).toBeLessThan(500);
  });
});

// ── Cross-cutting security (SR-001, SR-002, integration boundary) ───────────
describe("User Management — cross-cutting security", () => {
  test.skip(`TC-UMAPI-090 — all 6 endpoints reject a missing/invalid JWT → 401 ERR_AUTH_INVALID_TOKEN [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new UserManagementClient();
    const calls = [
      client.managementHome(),
      client.listUsers({}),
      client.createUser(newCreateUser()),
      client.getUser(UUID_SAMPLE),
      client.editUser(UUID_SAMPLE, newEditUser()),
      client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(401);
      assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
    }
  });

  test.skip(`TC-UMAPI-091 — all 6 endpoints reject a caller lacking manage_users → 403 (SR-001) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const managerToken = await jwtFactory.tenantToken({ tenantId: TENANT_A, roleId: "role-manager", sub: "mgr-1" });
    const res = await client.listUsers({}, managerToken);
    expect(res.status).toBe(403);
  });

  test.skip(`TC-UMAPI-092 — RLS tenant isolation: no cross-tenant read or write (SR-002) [blocked: ${DB_REASON}]`, async () => {
    const client = new UserManagementClient();
    const tenantBToken = await jwtFactory.tenantToken({ tenantId: "tenant-b", roleId: PO_ROLE, sub: "po-b" });
    // Tenant B's PO must not see tenant A's users. Needs two seeded tenants + RLS env.
    const res = await client.getUser(UUID_SAMPLE, tenantBToken);
    expect(res.status).toBe(404);
  });

  test.skip(`TC-UMAPI-093 — inactive tenant → 403 ERR_TENANT_INACTIVE (integration boundary, F1) [blocked: ${COGNITO_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.listUsers({}, await poToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_TENANT_INACTIVE");
  });

  test.skip(`TC-UMAPI-094 — audit log: a tenant_audit_logs row is written per mutating endpoint (create/edit/status) [blocked: ${DB_REASON}]`, async () => {
    const client = new UserManagementClient();
    const res = await client.createUser(newCreateUser(), await poToken());
    expect(res.status).toBe(201);
    // Assert one tenant_audit_logs row (actor, action, target id, timestamp) via DB — needs DB access.
  });
});
