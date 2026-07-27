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
import { afterEach, beforeAll, describe, expect } from "vitest";
import { UserManagementClient } from "../src/clients/userManagementClient";
import { signTenantToken } from "../local-env/localCognitoMock";
import {
  createManagedTenant,
  deleteFixtureTenant,
  type ManagedTenant,
} from "../src/utils/dbFixtures";
import { isLiveEnv } from "../src/config/env";
import { test, localOnly, liveOnly, deferred } from "../src/utils/suite";
import { liveOwnerContext } from "../src/utils/poContext";
import { validAdminToken } from "../src/utils/testTokens";
import { AdminPortalClient } from "../src/clients/adminPortalClient";
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
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";

const COGNITO_REASON =
  "POST/PATCH call the real Cognito Admin API — no local mock and dev is admin-only (needs a Cognito tenant-pool test sandbox)";
const d = describe;

const client = new UserManagementClient();
const UUID_SAMPLE = "a1b2c3d4-0000-4000-8000-000000000001";

// On a live target, pre-mint (and cache) the tenant token so the first test doesn't eat the
// cold Cognito-login latency and time out.
beforeAll(async () => {
  // Best-effort warm-up only. If the DEV_TENANT_* credential is bad/rotated, don't crash the
  // whole file in the hook — let the individual live tests surface the login error.
  if (isLiveEnv()) {
    try {
      await liveOwnerContext();
    } catch {
      /* tests will report the tenant-login failure individually */
    }
  }
}, 30000);

const createdTenants: string[] = [];
// Managed users created through POST /users during a test — torn down via the admin
// DELETE /admin/tenants/:id/users/:userId endpoint (which also removes the Cognito user),
// so create/edit/status tests leave no residue on the shared dev tenant.
const createdUsers: Array<{ tenantId: string; userId: string }> = [];
const adminClient = new AdminPortalClient();

async function adminDeleteUser(tenantId: string, userId: string): Promise<void> {
  try {
    const token = await validAdminToken();
    await adminClient.deleteTenantUser(tenantId, userId, token);
  } catch {
    /* best-effort teardown */
  }
}

afterEach(async () => {
  while (createdUsers.length > 0) {
    const u = createdUsers.pop();
    if (u) await adminDeleteUser(u.tenantId, u.userId);
  }
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

// Write tests exercise the real Cognito Admin API (create/disable/enable, email change), so
// they run on a live target (dev) only — the local Docker backend can't reach Cognito.
// `liveOnly` (from src/utils/suite) drops on local; `deferred` marks not-yet-automatable cases.

/** Creates a managed user via POST /users (PO), tracks it for admin teardown, returns the created user. */
async function createManagedUser(
  ctx: PoCtx,
  overrides: Partial<{ role: "procurement_manager" | "procurement_analyst"; name: string; email: string }> = {},
): Promise<{ body: ReturnType<typeof newCreateUser>; user: { id: string; email: string; name: string }; res: Awaited<ReturnType<typeof client.createUser>> }> {
  const body = newCreateUser(overrides);
  const res = await client.createUser(body, ctx.poToken);
  const parsed = createUserResponseSchema.parse(res.data);
  createdUsers.push({ tenantId: ctx.tenantId, userId: parsed.data.user.id });
  return { body, user: { id: parsed.data.user.id, email: parsed.data.user.email, name: parsed.data.user.name }, res };
}

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
  test("TC-UMAPI-001 — 200 envelope: organization + profile with field mapping @smoke @regression", async () => {
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

  test("TC-UMAPI-002 — organization fields present (nullable) per contract @regression", async () => {
    const { poToken } = await seedTenant();
    const res = await client.managementHome(poToken);
    expect(res.status).toBe(200);
    const parsed = managementHomeResponseSchema.parse(res.data);
    expect(parsed.data.organization).toHaveProperty("address");
  });
});

// ── GET /users (list, search, filter, paginate) ─────────────────────────────
d("GET /users", () => {
  test("TC-UMAPI-010 — 200 list envelope, user object shape, pagination metadata @smoke @regression", async () => {
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

  test("TC-UMAPI-012-1 — ILIKE escaping; input=\"100% match\" treated as literal @regression", () => assertSearchInputLiteral("100% match"));
  test("TC-UMAPI-012-2 — ILIKE escaping; input=\"under_score\" treated as literal @regression", () => assertSearchInputLiteral("under_score"));
  test("TC-UMAPI-012-3 — ILIKE escaping; input=\"'; DROP TABLE users;--\" treated as literal @regression", () => assertSearchInputLiteral("'; DROP TABLE users;--"));
  test("TC-UMAPI-012-4 — ILIKE escaping; input=\"%\" treated as literal @regression", () => assertSearchInputLiteral("%"));
  test("TC-UMAPI-012-5 — ILIKE escaping; input=\"_\" treated as literal @regression", () => assertSearchInputLiteral("_"));

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

  test("TC-UMAPI-014 — self-exclusion: PO's own record never in the list (SR-003) @regression", async () => {
    const { poToken, po } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({}, poToken);
    const parsed = listResponseSchema.parse(res.data);
    expect(parsed.data.users.every((u) => u.email !== po.email)).toBe(true);
  });

  test("TC-UMAPI-015 — pagination: page beyond last returns no server error @regression", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const beyond = await client.listUsers({ page: 999 }, poToken);
    expect(beyond.status).toBeLessThan(500);
  });

  test("TC-UMAPI-016 — display_id shape USR-#### on every listed user @regression", async () => {
    const { poToken } = await seedTenant({ withManagedUsers: true });
    const res = await client.listUsers({}, poToken);
    const parsed = listResponseSchema.parse(res.data);
    for (const u of parsed.data.users) expect(u.displayId).toMatch(/^USR-\d{4}$/);
  });

  test("TC-UMAPI-017 — search trimmed; whitespace-only treated as empty @regression", async () => {
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

// ── POST /users (create) — real Cognito, dev-only (liveOnly), admin teardown ──────────
describe("POST /users", () => {
  liveOnly(`TC-UMAPI-030 — create 201 contract, permission label derived, message field @smoke @regression`, async () => {
    const ctx = await seedTenant();
    const { body, res } = await createManagedUser(ctx, { role: "procurement_manager" });
    assertResponseTime(res);
    expect(res.status).toBe(201);
    const parsed = createUserResponseSchema.parse(res.data);
    expect(parsed.data.user.permissionLabel).toBe("Read/Write");
    // Echoed under data.user (not top-level data) — assert directly.
    expect(parsed.data.user.name).toBe(body.name);
    expect(parsed.data.user.email).toBe(body.email.toLowerCase());
  });

  liveOnly(`TC-UMAPI-031 — validation → 400 ERR_VALIDATION_FAILED with exact message @regression`, async () => {
    const ctx = await seedTenant();
    const res = await client.createUser(CREATE_INVALID_EMAIL, ctx.poToken);
    expect(res.status).toBe(400);
    assertErrorEnvelope(res, "ERR_VALIDATION_FAILED");
    // CONTRACT: error.message is the generic envelope text; per-field specifics live in details.
    // (The scaffold's "Please fill in all fields with a valid email." was a wrong guess.)
    expect((res.data as { error: { message: string } }).error.message).toBe("One or more fields are invalid.");
  });

  liveOnly(`TC-UMAPI-032 — same-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_TENANT @regression`, async () => {
    const ctx = await seedTenant();
    const { body } = await createManagedUser(ctx); // first user owns the email
    const res = await client.createUser(body, ctx.poToken); // same email again, same tenant
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_TENANT");
  });

  // TC-UMAPI-033 (cross-tenant email clash → ERR_EMAIL_ALREADY_IN_USE) needs an email already
  // provisioned in a DIFFERENT dev tenant — no stable fixture for that exists, so it stays skipped.
  deferred(`TC-UMAPI-033 — cross-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_USE [blocked: needs a known email provisioned in another dev tenant]`, async () => {
    const res = await client.createUser(newCreateUser({ email: "existing.other@othertenant.com" }), await skipToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_USE");
  });

  liveOnly(`TC-UMAPI-034 — temporary password never present in the create response (SR-008) @regression`, async () => {
    const ctx = await seedTenant();
    const { res } = await createManagedUser(ctx);
    const raw = JSON.stringify(res.data).toLowerCase();
    expect(raw).not.toContain("temporarypassword");
    expect(raw).not.toContain("\"password\"");
  });

  liveOnly(`TC-UMAPI-035 — display_id USR-#### format on the created user @regression`, async () => {
    const ctx = await seedTenant();
    const { res } = await createManagedUser(ctx);
    const parsed = createUserResponseSchema.parse(res.data);
    expect(parsed.data.user.displayId).toMatch(/^USR-\d{4}$/);
  });

  liveOnly(`TC-UMAPI-036 — double-submit: repeat POST same email → 409 (no duplicate) @regression`, async () => {
    const ctx = await seedTenant();
    const { body, res: first } = await createManagedUser(ctx);
    const second = await client.createUser(body, ctx.poToken);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
  });

  liveOnly(`TC-UMAPI-037 — name max-length boundary (255) accepted @regression`, async () => {
    const ctx = await seedTenant();
    const { res } = await createManagedUser(ctx, { name: CREATE_NAME_MAX_255.name });
    expect(res.status).toBe(201);
    createUserResponseSchema.parse(res.data);
  });
});

// ── GET /users/:id ──────────────────────────────────────────────────────────
d("GET /users/:id", () => {
  test("TC-UMAPI-050 — 200 single-user detail contract @smoke @regression", async () => {
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

  test("TC-UMAPI-051 — 404 ERR_USER_NOT_FOUND for an unknown id @regression", async () => {
    const { poToken } = await seedTenant();
    const res = await client.getUser("00000000-0000-4000-8000-000000000000", poToken);
    expect(res.status).toBe(404);
    assertErrorEnvelope(res, "ERR_USER_NOT_FOUND");
  });

  test("TC-UMAPI-052 — invalid UUID path param → client error (400 vs 404 contract-TBD) @regression", async () => {
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

// ── PATCH /users/:id (edit) — real Cognito, dev-only, admin teardown ──────────
describe("PATCH /users/:id", () => {
  liveOnly(`TC-UMAPI-060 — Branch A: name-only change → 200, emailChanged omitted/false @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx);
    const res = await client.editUser(user.id, { name: "Renamed User", role: body.role, email: body.email }, ctx.poToken);
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged ?? false).toBe(false);
    expect(parsed.data.user.name).toBe("Renamed User");
  });

  liveOnly(`TC-UMAPI-061 — Branch B: role change → permissionLabel reflects new role (SR-006) @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx, { role: "procurement_manager" });
    const res = await client.editUser(user.id, { name: body.name, role: "procurement_analyst", email: body.email }, ctx.poToken);
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.user.permissionLabel).toBe("Read Only");
  });

  liveOnly(`TC-UMAPI-062 — Branch C: email change → emailChanged true + temp-password message (SR-007) @smoke @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx);
    const newEmail = `changed.${Date.now().toString(36)}@yopmail.com`;
    const res = await client.editUser(user.id, { name: body.name, role: body.role, email: newEmail }, ctx.poToken);
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged).toBe(true);
    expect((parsed.data.message ?? "").toLowerCase()).toContain("temporary password");
  });

  liveOnly(`TC-UMAPI-063 — no-op: nothing changed → success @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx);
    const res = await client.editUser(user.id, { name: body.name, role: body.role, email: body.email }, ctx.poToken);
    expect(res.status).toBe(200);
  });

  liveOnly(`TC-UMAPI-064 — case-only email is not a real change (Branch A / no-op) @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx);
    const res = await client.editUser(user.id, { name: body.name, role: body.role, email: body.email.toUpperCase() }, ctx.poToken);
    expect(res.status).toBe(200);
    const parsed = editUserResponseSchema.parse(res.data);
    expect(parsed.data.emailChanged ?? false).toBe(false);
  });

  // TC-UMAPI-065 (self-modification 403) needs the caller PO's OWN users.id, which no API
  // exposes on dev (the list excludes self, management-home has no id) — stays skipped.
  deferred(`TC-UMAPI-065 — self-modification → 403 ERR_SELF_MODIFICATION_FORBIDDEN (SR-003) [blocked: PO's own user id not exposed via any dev API]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser(), await skipToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_SELF_MODIFICATION_FORBIDDEN");
  });

  liveOnly(`TC-UMAPI-066 — edit same-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_TENANT @regression`, async () => {
    const ctx = await seedTenant();
    const a = await createManagedUser(ctx);
    const b = await createManagedUser(ctx);
    const res = await client.editUser(a.user.id, { name: a.body.name, role: a.body.role, email: b.body.email }, ctx.poToken);
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_TENANT");
  });

  // TC-UMAPI-067/070 (cross-tenant email clash) need an email provisioned in another dev tenant.
  deferred(`TC-UMAPI-067 — edit cross-tenant email clash → 409 ERR_EMAIL_ALREADY_IN_USE [blocked: needs an email in another dev tenant]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.other@othertenant.com" }), await skipToken());
    expect(res.status).toBe(409);
    assertErrorEnvelope(res, "ERR_EMAIL_ALREADY_IN_USE");
  });

  liveOnly(`TC-UMAPI-068 — edit validation → 400; unknown id → 404 @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx);
    const invalid = await client.editUser(user.id, { name: "   ", role: body.role, email: body.email }, ctx.poToken);
    expect(invalid.status).toBe(400);
    assertErrorEnvelope(invalid, "ERR_VALIDATION_FAILED");
    const missing = await client.editUser("00000000-0000-4000-8000-000000000000", newEditUser(), ctx.poToken);
    expect(missing.status).toBe(404);
  });

  liveOnly(`TC-UMAPI-069 — temp password never present in the edit (email-change) response (SR-008) @regression`, async () => {
    const ctx = await seedTenant();
    const { body, user } = await createManagedUser(ctx);
    const res = await client.editUser(user.id, { name: body.name, role: body.role, email: `brand.${Date.now().toString(36)}@yopmail.com` }, ctx.poToken);
    expect(JSON.stringify(res.data).toLowerCase()).not.toContain("temporarypassword");
  });

  deferred(`TC-UMAPI-070 — Cognito-first ordering: Cognito failure aborts before any DB write [blocked: needs an email in another dev tenant]`, async () => {
    const res = await client.editUser(UUID_SAMPLE, newEditUser({ email: "peer.other@othertenant.com" }), await skipToken());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── PATCH /users/:id/status — real Cognito, dev-only, admin teardown ──────────
describe("PATCH /users/:id/status", () => {
  liveOnly(`TC-UMAPI-080 — deactivate → status=inactive (SR-005) @smoke @regression`, async () => {
    const ctx = await seedTenant();
    const { user } = await createManagedUser(ctx);
    const res = await client.setStatus(user.id, STATUS_DEACTIVATE, ctx.poToken);
    assertResponseTime(res);
    expect(res.status).toBe(200);
    const parsed = statusResponseSchema.parse(res.data);
    expect(parsed.data.user.status).toBe("inactive");
  });

  liveOnly(`TC-UMAPI-081 — reactivate → status=active @regression`, async () => {
    const ctx = await seedTenant();
    const { user } = await createManagedUser(ctx);
    await client.setStatus(user.id, STATUS_DEACTIVATE, ctx.poToken);
    const res = await client.setStatus(user.id, STATUS_ACTIVATE, ctx.poToken);
    expect(res.status).toBe(200);
    const parsed = statusResponseSchema.parse(res.data);
    expect(parsed.data.user.status).toBe("active");
  });

  liveOnly(`TC-UMAPI-082 — same-status submission → success no-op @regression`, async () => {
    const ctx = await seedTenant();
    const { user } = await createManagedUser(ctx);
    await client.setStatus(user.id, STATUS_DEACTIVATE, ctx.poToken);
    const res = await client.setStatus(user.id, STATUS_DEACTIVATE, ctx.poToken);
    expect(res.status).toBe(200);
  });

  // TC-UMAPI-083 (status self-modification 403) needs the PO's own user id — not exposed via API.
  deferred(`TC-UMAPI-083 — status self-modification → 403 ERR_SELF_MODIFICATION_FORBIDDEN (SR-003) [blocked: PO's own user id not exposed via any dev API]`, async () => {
    const res = await client.setStatus(UUID_SAMPLE, STATUS_DEACTIVATE, await skipToken());
    expect(res.status).toBe(403);
    assertErrorEnvelope(res, "ERR_SELF_MODIFICATION_FORBIDDEN");
  });

  liveOnly(`TC-UMAPI-084 — status validation → 400; unknown id → 404 @regression`, async () => {
    const ctx = await seedTenant();
    const { user } = await createManagedUser(ctx);
    const invalid = await client.setStatus(user.id, { status: "banana" }, ctx.poToken);
    expect(invalid.status).toBe(400);
    const missing = await client.setStatus("00000000-0000-4000-8000-000000000000", STATUS_DEACTIVATE, ctx.poToken);
    expect(missing.status).toBe(404);
  });

  liveOnly(`TC-UMAPI-085 — activate an already-active user → no server error @regression`, async () => {
    const ctx = await seedTenant();
    const { user } = await createManagedUser(ctx);
    const res = await client.setStatus(user.id, STATUS_ACTIVATE, ctx.poToken);
    expect(res.status).toBeLessThan(500);
  });
});

// ── Cross-cutting security (SR-001, SR-002, integration boundary) ───────────
d("User Management — cross-cutting security", () => {
  test("TC-UMAPI-090 — all 6 endpoints reject a missing JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke @regression", async () => {
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

  deferred(`TC-UMAPI-094 — audit log: a tenant_audit_logs row per mutating endpoint [blocked: ${COGNITO_REASON}]`, async () => {
    const res = await client.createUser(newCreateUser(), await skipToken());
    expect(res.status).toBe(201);
  });
});
