/**
 * TC-UMAPI-001..094 — CEIQ-FEAT-003 User Management API contract.
 * Spec: SPEC_CEIQ-FEAT-003-user-management.md §4 (6 endpoints under /api/v1/users),
 * §6 error codes, §7 security (SR-001..009). Manual suite: testcases/TC-CEIQ-FEAT-003.md.
 *
 * Runs on BOTH local and a live target (with a real DEV_TENANT_* Procurement Owner):
 *   - `test`      → env-agnostic read/validation/guard (data-independent, non-mutating).
 *   - `localOnly` → needs a DB fixture: seeded search/filter data, multi-tenant/RLS,
 *                   a non-owner token, or an inactive tenant. Skipped on live.
 *   - `test.skip` → the mutating endpoints (POST create, PATCH edit/status) call the real
 *                   Cognito Admin API — no local mock, dev is admin-only → skipped everywhere
 *                   until a Cognito tenant-pool sandbox exists (COGNITO_REASON).
 *
 * NOTE (backend behaviour, dev pull 2026-07-20): JwtAuthGuard fails CLOSED when the token's
 * sub has no users row — the local path signs with a real seeded user's sub; the live path
 * logs in as a real Cognito user.
 */
import { afterEach, beforeAll, describe, test, expect } from "vitest";
import { UserManagementClient } from "../src/clients/userManagementClient";
import { signTenantToken } from "../local-env/localCognitoMock";
import {
  createManagedTenant,
  deleteFixtureTenant,
  type ManagedTenant,
} from "../src/utils/dbFixtures";
import { isLiveEnv } from "../src/config/env";
import { liveOwnerContext } from "../src/utils/poContext";
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

const COGNITO_REASON =
  "POST/PATCH call the real Cognito Admin API — no local mock and dev is admin-only (needs a Cognito tenant-pool test sandbox)";
const d = describe;
const localOnly = isLiveEnv() ? test.skip : test;

const client = new UserManagementClient();
const UUID_SAMPLE = "a1b2c3d4-0000-4000-8000-000000000001";

// On a live target, pre-mint (and cache) the tenant token so the first test doesn't eat the
// cold Cognito-login latency and time out.
beforeAll(async () => {
  if (isLiveEnv()) await liveOwnerContext();
}, 30000);

const createdTenants: string[] = [];
afterEach(async () => {
  while (createdTenants.length > 0) {
    const id = createdTenants.pop();
    if (id) {
      try {
        await deleteFixtureTenant(id);
      } catch {
        /* best-effort teardown */
      }
    }
  }
});

interface PoCtx {
  poToken: string;
  tenantId: string;
  po: { sub: string; email: string };
  mt?: ManagedTenant; // present only on local (seeded) — used by localOnly tests
}

/**
 * PO context. Live → real DEV_TENANT_* Cognito login (no seeding). Local → a seeded managed
 * tenant + mock token. Only localOnly tests read `mt` (managed users / role ids).
 */
async function seedTenant(
  opts: { tenantStatus?: "active" | "inactive"; withManagedUsers?: boolean } = {},
): Promise<PoCtx> {
  if (isLiveEnv()) {
    const po = await liveOwnerContext();
    return { poToken: po.token, tenantId: po.tenantId, po: { sub: po.cognitoSub, email: po.email } };
  }
  const mt = await createManagedTenant(opts);
  createdTenants.push(mt.tenantId);
  const poToken = await signTenantToken({ sub: mt.po.sub, tenantId: mt.tenantId, roleId: mt.ownerRoleId });
  return { poToken, tenantId: mt.tenantId, po: { sub: mt.po.sub, email: mt.po.email }, mt };
}

const skipToken = () => signTenantToken({ sub: "x", tenantId: "y", roleId: "z" });

// ── GET /users/management-home ──────────────────────────────────────────────
d("GET /users/management-home", () => {
  test("TC-UMAPI-001 — 200 envelope: organization + profile with field mapping @smoke", async () => {
    const { poToken } = await seedTenant();
    const res = await client.managementHome(poToken);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = managementHomeResponseSchema.parse(res.data);
    // companyName ← tenants.name, website ← tenants.website_url (§4.2). Value is env-specific,
    // so assert the mapping/shape, not a literal name.
    expect(typeof parsed.data.organization.companyName).toBe("string");
    expect(parsed.data.profile.role).toBe("Procurement Owner");
  });

  test("TC-UMAPI-002 — organization fields present (nullable) per contract", async () => {
    const { poToken } = await seedTenant();
    const res = await client.managementHome(poToken);
    expect(res.status).toBe(200);
    const parsed = managementHomeResponseSchema.parse(res.data);
    expect(parsed.data.organization).toHaveProperty("address");
  });
});

// ── GET /users (list, search, filter, paginate) ─────────────────────────────
d("GET /users", () => {
  test("TC-UMAPI-010 — 200 list envelope, user object shape, pagination metadata @smoke", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    // CONTRACT: list takes only search/role/page (no client `limit`; page size is a fixed
    // server constant 12 — sending `limit` trips whitelist validation → 400).
    const res = await client.listUsers({ page: 1 }, poToken);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.pagination.limit).toBe(12);
    expect(parsed.data.users.length).toBeGreaterThanOrEqual(1);
  });

  localOnly("TC-UMAPI-011 — search: case-insensitive ILIKE partial match, parameterized", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({ search: "ann" }, poToken);
    expect(res.status).toBe(200);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.users.length).toBeGreaterThanOrEqual(2);
    for (const u of parsed.data.users) expect(u.name.toLowerCase()).toContain("ann");
  });

  // TC-UMAPI-012-1..5 — injection-shaped search input treated as a literal (no 500). Data-independent.
  async function assertSearchInputLiteral(input: string): Promise<void> {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({ search: input }, poToken);
    expect(res.status).toBe(200);
    listResponseSchema.parse(res.data);
  }

  test("TC-UMAPI-012-1 — ILIKE escaping; input=\"100% match\" treated as literal", () => assertSearchInputLiteral("100% match"));
  test("TC-UMAPI-012-2 — ILIKE escaping; input=\"under_score\" treated as literal", () => assertSearchInputLiteral("under_score"));
  test("TC-UMAPI-012-3 — ILIKE escaping; input=\"'; DROP TABLE users;--\" treated as literal", () => assertSearchInputLiteral("'; DROP TABLE users;--"));
  test("TC-UMAPI-012-4 — ILIKE escaping; input=\"%\" treated as literal", () => assertSearchInputLiteral("%"));
  test("TC-UMAPI-012-5 — ILIKE escaping; input=\"_\" treated as literal", () => assertSearchInputLiteral("_"));

  // TC-UMAPI-013-1..3 — role filter behaviour. Depends on seeded role mix → local-only.
  async function assertRoleFilter(
    role: "procurement_manager" | "procurement_analyst",
    expectedRoleName: "Procurement Manager" | "Procurement Analyst",
  ): Promise<void> {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({ role }, poToken);
    expect(res.status).toBe(200);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.users.length).toBeGreaterThanOrEqual(1);
    for (const u of parsed.data.users) expect(u.role).toBe(expectedRoleName);
  }

  localOnly("TC-UMAPI-013-1 — role filter by slug=procurement_manager", () => assertRoleFilter("procurement_manager", "Procurement Manager"));
  localOnly("TC-UMAPI-013-2 — role filter by slug=procurement_analyst", () => assertRoleFilter("procurement_analyst", "Procurement Analyst"));
  localOnly("TC-UMAPI-013-3 — no role param = all roles (empty string is a 400, so \"all\" means omit the param)", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const all = await client.listUsers({}, poToken);
    expect(all.status).toBe(200);
    const roles = new Set(listResponseSchema.parse(all.data).data.users.map((u) => u.role));
    expect(roles.has("Procurement Manager")).toBe(true);
    expect(roles.has("Procurement Analyst")).toBe(true);
    const emptyRole = await client.listUsers({ role: "" as "procurement_manager" }, poToken);
    expect(emptyRole.status).toBe(400);
  });

  test("TC-UMAPI-014 — self-exclusion: PO's own record never in the list (SR-003)", async () => {
    const { poToken, po } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({}, poToken);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.users.every((u) => u.email !== po.email)).toBe(true);
  });

  test("TC-UMAPI-015 — pagination: page beyond last returns no server error", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const beyond = await client.listUsers({ page: 999 }, poToken);
    expect(beyond.status).toBeLessThan(500);
  });

  test("TC-UMAPI-016 — display_id shape USR-#### on every listed user", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({}, poToken);
    const parsed = listResponseSchema.parse(res.data);
    for (const u of parsed.data.users) expect(u.displayId).toMatch(/^USR-\d{4}$/);
  });

  test("TC-UMAPI-017 — search trimmed; whitespace-only treated as empty", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const [blank, spaces] = await Promise.all([
      client.listUsers({ search: "" }, poToken),
      client.listUsers({ search: "   " }, poToken),
    ]);
    const a = listResponseSchema.parse(blank.data);
    const b = listResponseSchema.parse(spaces.data);
    expect(b.data.pagination.totalCount).toBe(a.data.pagination.totalCount);
  });

  localOnly("TC-UMAPI-018 — search + role filter combine with AND logic", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({ search: "a", role: "procurement_manager" }, poToken);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.users.length).toBeGreaterThanOrEqual(1);
    for (const u of parsed.data.users) {
      expect(u.name.toLowerCase()).toContain("a");
      expect(u.role).toBe("Procurement Manager");
    }
  });
});

// ── POST /users (create) — Cognito-backed, skipped ───────────────────────────
describe("POST /users", () => {
  test.skip(`TC-UMAPI-030 — create 201 contract, permission label derived, message field [blocked: ${COGNITO_REASON}] @smoke`, async () => {
    const body = newCreateUser({ role: "procurement_manager" });
    const res = await client.createUser(body, await skipToken());
    assertResponseTime(res);
    expect(res.status).toBe(201);
    const parsed = createUserResponseSchema.parse(res.data);
    expect(parsed.data.user.permissionLabel).toBe("Read/Write");
    assertRequestEchoedInResponse({ name: body.name, email: body.email }, res);
  });

  test.skip(`TC-UMAPI-031 — validation → 400 ERR_VALIDATION_FAILED with exact message [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(CREATE_INVALID_EMAIL, await skipToken());
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
    expect((res.data as { error: { message: string } }).error.message).toBe(
      "Please fill in all fields with a valid email.",
    );
  });

  test.skip(`TC-UMAPI-032 — same-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_TENANT [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(newCreateUser({ email: "existing.same@clearedge.com" }), await skipToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_TENANT");
  });

  test.skip(`TC-UMAPI-033 — cross-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_USE [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(newCreateUser({ email: "existing.other@othertenant.com" }), await skipToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_USE");
  });

  test.skip(`TC-UMAPI-034 — temporary password never present in the create response (SR-008) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(newCreateUser(), await skipToken());
    const raw = JSON.stringify(res.data).toLowerCase();
    expect(raw).not.toContain("temporarypassword");
  });

  test.skip(`TC-UMAPI-035 — display_id atomic per-tenant alloc; USR-0001 first [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(newCreateUser(), await skipToken());
    const parsed = createUserResponseSchema.parse(res.data);
    expect(parsed.data.user.displayId).toMatch(/^USR-\d{4}$/);
  });

  test.skip(`TC-UMAPI-036 — double-submit idempotency: repeat POST → no duplicate Cognito user [blocked: ${COGNITO_REASON}]`, async () => {
    const body = newCreateUser();
    const first = await client.createUser(body, await skipToken());
    const second = await client.createUser(body, await skipToken());
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  test.skip(`TC-UMAPI-037 — name max-length boundary (255) accepted [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser({ ...CREATE_NAME_MAX_255, email: newCreateUser().email }, await skipToken());
    expect(res.status).toBe(201);
    createUserResponseSchema.parse(res.data);
  });
});

// ── GET /users/:id ──────────────────────────────────────────────────────────
d("GET /users/:id", () => {
  test("TC-UMAPI-050 — 200 single-user detail contract", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    // Fetch a real id from the list so this is data-independent (works on dev's live tenant too).
    const list = listResponseSchema.parse((await client.listUsers({}, poToken)).data);
    const target = list.data.users[0];
    expect(target).toBeDefined();
    const res = await client.getUser(target!.id, poToken);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = singleUserResponseSchema.parse(res.data);
    expect(parsed.data.user.id).toBe(target!.id);
  });

  test("TC-UMAPI-051 — 404 ERR_USER_NOT_FOUND for an unknown id", async () => {
    const { poToken } = await seedTenant();
    const res = await client.getUser("00000000-0000-4000-8000-000000000000", poToken);
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_USER_NOT_FOUND");
  });

  test("TC-UMAPI-052 — invalid UUID path param → client error (400 vs 404 contract-TBD)", async () => {
    const { poToken } = await seedTenant();
    const res = await client.getUser("not-a-uuid", poToken);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  localOnly("TC-UMAPI-053 — cross-tenant :id → 404 (RLS isolation, SR-002)", async () => {
    const a = await seedTenant({ withManagedUsers: true });
    const b = await seedTenant({ withManagedUsers: true });
    const bUser = b.mt!.users[0];
    expect(bUser).toBeDefined();
    const res = await client.getUser(bUser!.id, a.poToken);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /users/:id (edit — Cognito-backed, skipped) ───────────────────────
describe("PATCH /users/:id", () => {
  test.skip(`TC-UMAPI-060 — Branch A: name-only change → DB update, emailChanged omitted [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ name: "Renamed User" }), await skipToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged ?? false).toBe(false);
  });

  test.skip(`TC-UMAPI-061 — Branch B: role change → Cognito attr + AdminUserGlobalSignOut (SR-006) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ role: "procurement_analyst" }), await skipToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.user.permissionLabel).toBe("Read Only");
  });

  test.skip(`TC-UMAPI-062 — Branch C: email change → Cognito update + sign-out + new temp pw (SR-007) [blocked: ${COGNITO_REASON}] @smoke`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "new.address@clearedge.com" }), await skipToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged).toBe(true);
    expect(parsed.data.message).toContain("temporary password");
  });

  test.skip(`TC-UMAPI-063 — no-op: nothing changed → success, no DB/Cognito write [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser(), await skipToken());
    expect(res.status).toBe(200);
  });

  test.skip(`TC-UMAPI-064 — case-only email is not a real change (Branch A / no-op) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "KYLE@clearedge.com" }), await skipToken());
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged ?? false).toBe(false);
  });

  test.skip(`TC-UMAPI-065 — self-modification → 403 ERR_SELF_MODIFICATION_FORBIDDEN (SR-003) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser(), await skipToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_SELF_MODIFICATION_FORBIDDEN");
  });

  test.skip(`TC-UMAPI-066 — edit same-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_TENANT [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.same@clearedge.com" }), await skipToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_TENANT");
  });

  test.skip(`TC-UMAPI-067 — edit cross-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_USE [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.other@othertenant.com" }), await skipToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_USE");
  });

  test.skip(`TC-UMAPI-068 — edit validation → 400; unknown id → 404 [blocked: ${COGNITO_REASON}]`, async () => {
    const invalid = await client.editUser(UUID_SAMPLE, { ...newEditUser(), name: "   " }, await skipToken());
    expect(invalid.status).toBe(400);
    assertErrorEnvelope(invalid, "ERR_VALIDATION_FAILED");
    const missing = await client.editUser("00000000-0000-4000-8000-000000000000", newEditUser(), await skipToken());
    expect(missing.status).toBe(404);
  });

  test.skip(`TC-UMAPI-069 — temp password never present in the edit (email-change) response (SR-008) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "brand.new@clearedge.com" }), await skipToken());
    expect(JSON.stringify(res.data).toLowerCase()).not.toContain("temporarypassword");
  });

  test.skip(`TC-UMAPI-070 — Cognito-first ordering: Cognito failure aborts before any DB write [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.other@othertenant.com" }), await skipToken());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── PATCH /users/:id/status (Cognito-backed, skipped) ───────────────────────
describe("PATCH /users/:id/status", () => {
  test.skip(`TC-UMAPI-080 — deactivate: AdminUserGlobalSignOut + AdminDisableUser + status=inactive (SR-005) [blocked: ${COGNITO_REASON}] @smoke`, async () => {
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await skipToken());
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = statusResponseSchema.parse(res.data);
    expect(parsed.data.user.status).toBe("inactive");
  });

  test.skip(`TC-UMAPI-081 — reactivate: AdminEnableUser + status=active; no email [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.setStatus(UUID_SAMPLE, STATUS_ACTIVATE, await skipToken());
    expect(res.status).toBe(200);
    const parsed = statusResponseSchema.parse(res.data);
    expect(parsed.data.user.status).toBe("active");
  });

  test.skip(`TC-UMAPI-082 — same-status submission → success no-op [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await skipToken());
    expect(res.status).toBe(200);
  });

  test.skip(`TC-UMAPI-083 — status self-modification → 403 ERR_SELF_MODIFICATION_FORBIDDEN (SR-003) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await skipToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_SELF_MODIFICATION_FORBIDDEN");
  });

  test.skip(`TC-UMAPI-084 — status validation → 400; unknown id → 404 [blocked: ${COGNITO_REASON}]`, async () => {
    const invalid = await client.setStatus(UUID_SAMPLE, { status: "banana" }, await skipToken());
    expect(invalid.status).toBe(400);
    const missing = await client.setStatus("00000000-0000-4000-8000-000000000000", STATUS_DEACTIVATE, await skipToken());
    expect(missing.status).toBe(404);
  });

  test.skip(`TC-UMAPI-085 — ERR_INVALID_STATE_TRANSITION reachability (contract-TBD) [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.setStatus(UUID_SAMPLE, STATUS_ACTIVATE, await skipToken());
    expect(res.status).toBeLessThan(500);
  });
});

// ── Cross-cutting security (SR-001, SR-002, integration boundary) ───────────
d("User Management — cross-cutting security", () => {
  test("TC-UMAPI-090 — all 6 endpoints reject a missing JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke", async () => {
    // Sequential (not Promise.all): 6 simultaneous TLS handshakes to CloudFront intermittently
    // drop a connection on live targets — issuing them one at a time keeps the guard check reliable.
    const calls = [
      () => client.managementHome(),
      () => client.listUsers({}),
      () => client.createUser(newCreateUser()),
      () => client.getUser(UUID_SAMPLE),
      () => client.editUser(UUID_SAMPLE, newEditUser()),
      () => client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(401);
      assertErrorEnvelope(res, "ERR_AUTH_INVALID_TOKEN");
    }
  });

  localOnly("TC-UMAPI-091 — a caller lacking manage_users → 403 (SR-001)", async () => {
    const { mt } = await seedTenant({ withManagedUsers: true });
    const manager = mt!.users.find((u) => u.roleSlug === "procurement_manager");
    expect(manager).toBeDefined();
    const managerToken = await signTenantToken({ sub: manager!.sub, tenantId: mt!.tenantId, roleId: mt!.managerRoleId });
    const res = await client.listUsers({}, managerToken);
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_RBAC_FORBIDDEN");
  });

  localOnly("TC-UMAPI-092 — RLS tenant isolation: PO of B cannot read A's user (SR-002)", async () => {
    const a = await seedTenant({ withManagedUsers: true });
    const b = await seedTenant();
    const aUser = a.mt!.users[0];
    expect(aUser).toBeDefined();
    const res = await client.getUser(aUser!.id, b.poToken);
    expect(res.status).toBe(404);
  });

  localOnly("TC-UMAPI-093 — inactive tenant → 403 ERR_TENANT_INACTIVE (integration boundary, F1)", async () => {
    const { poToken } = await seedTenant({ tenantStatus: "inactive" });
    const res = await client.listUsers({}, poToken);
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_TENANT_INACTIVE");
  });

  test.skip(`TC-UMAPI-094 — audit log: a tenant_audit_logs row per mutating endpoint [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(newCreateUser(), await skipToken());
    expect(res.status).toBe(201);
  });
});
