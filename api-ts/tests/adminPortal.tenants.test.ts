/**
 * TC-ADMAPI-001..006, 010..015, 020..022, 030..032, 040..042 + TC-ADMCREATE-008 —
 * CEIQ-FEAT-001 Admin Portal: /api/v1/admin/tenants (list, create, detail, company, status).
 * Spec: SPEC_CEIQ-FEAT-001-admin-portal.md §4.2, §5, §9; cases: testcases/TC-CEIQ-FEAT-001.md (Module: API).
 * Owner/handover endpoints live in tests/adminPortal.owner-handover.test.ts.
 *
 * DEFERRED (fault-injection PARTIAL — no black-box fault-injection harness exists; execute
 * manually with engineering support or as backend integration tests in clearedge-backend):
 *   - TC-ADMAPI-016 — create compensation: DB failure deletes the just-created Cognito user (§4.2 POST step 5).
 * Same constraint family: TC-ADMAPI-056/064/065 (see the owner-handover suite header).
 */
import { describe, test, expect } from "vitest";
import { randomUUID } from "crypto";
import type { AxiosResponse } from "axios";
import { AdminPortalClient } from "../src/clients/adminPortalClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
// Valid admin token signed by the local Cognito mock (shared keypair served by the
// JWKS server), so the app's AdminJwtAuthGuard actually accepts it — jwtFactory tokens
// use a random key/issuer and are only good for negative (rejection) cases.
import { signAdminToken } from "../local-env/localCognitoMock";
import { withDbClient } from "../src/utils/dbClient";
import { createSetupTenant, createHandedOverTenant, teardownTenant } from "../src/utils/adminPortalFixtures";
import {
  adminTenantCreatePayload,
  companyUpdatePayload,
  ownerUpdatePayload,
  createValidationMatrix,
  domainNormalizationVariants,
  maxLengthBoundaryMatrix,
  boundaryValueFor,
  uniqueDomain,
  uniqueEmail,
  LIST_PAGE_SIZE,
  DISPLAY_ID_PATTERN,
  ERR_VALIDATION_FAILED,
  ERR_NOT_FOUND,
  ERR_AUTH_INVALID_TOKEN,
  ERR_TENANT_DOMAIN_DUPLICATE,
  ERR_EMAIL_ALREADY_IN_USE,
  ERR_INVALID_STATE_TRANSITION,
  MSG_VALIDATION_FAILED,
  MSG_TENANT_NOT_FOUND,
  MSG_DOMAIN_DUPLICATE,
  MSG_EMAIL_IN_USE,
  MSG_CANNOT_ACTIVATE_IN_SETUP,
  FIELD_MESSAGES,
  FIELD_LIMITS,
  UNICODE_COMPANY_NAME,
  UNICODE_OWNER_NAME,
  UNICODE_ADDRESS,
} from "../src/payloads/adminPortalPayloads";
import {
  TenantListEnvelopeSchema,
  TenantDetailEnvelopeSchema,
  ErrorEnvelopeSchema,
} from "../src/schemas/adminPortalSchemas";
import { assertResponseTime, assertRequestEchoedInResponse, assertErrorEnvelope } from "../src/utils/assertions";
import type { ErrorEnvelope } from "../src/payloads/types";

// Endpoints ARE implemented (dev pull 2026-07-10). The remaining skips need an existing
// tenant, and the only API way to create one — POST /admin/tenants — calls the real AWS
// Cognito SDK, which is unreachable from the local Docker backend (ERR_COGNITO_OPERATION_FAILED).
// Guard / validation / pagination / 404 cases that don't need a created tenant are enabled above.
const SKIP_REASON =
  "requires a Cognito-provisioned tenant — POST /admin/tenants calls real Cognito, unavailable locally";
const jwtFactory = new JwtFactory();

/** Pulls `error.details.fields` out of a 400 ERR_VALIDATION_FAILED body. */
function validationFields(response: AxiosResponse): Record<string, string> {
  const err = response.data as ErrorEnvelope;
  return ((err.error.details as { fields?: Record<string, string> } | undefined)?.fields ?? {});
}

describe("Admin Portal — GET /admin/tenants (list)", () => {
  test.skip(`TC-ADMAPI-001 — list envelope, fixed page size 12, createdAt DESC + displayId tie-break, setupPassword never present [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — env fixture: ≥13 tenants incl. ≥1 in_setup and a shared created_at pair (tie-break).
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();

    // Act
    const page1 = await client.listTenants({ page: 1 }, adminToken);
    const page2 = await client.listTenants({ page: 2 }, adminToken);

    // Assert — status + schema + envelope invariants
    assertResponseTime(page1);
    assertResponseTime(page2);
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    const body1 = TenantListEnvelopeSchema.parse(page1.data);
    const body2 = TenantListEnvelopeSchema.parse(page2.data);
    expect(body1.data.pagination).toMatchObject({ page: 1, limit: LIST_PAGE_SIZE });
    expect(body1.data.tenants).toHaveLength(LIST_PAGE_SIZE);

    // Ordering: createdAt DESC with displayId DESC tie-break, continuous across pages.
    const all = [...body1.data.tenants, ...body2.data.tenants];
    const sorted = [...all].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.displayId.localeCompare(a.displayId),
    );
    expect(all.map((t) => t.id)).toEqual(sorted.map((t) => t.id));

    // setupPassword must never appear on any list item — assert on the RAW body (Zod strips unknown keys).
    const rawTenants = [
      ...(page1.data as { data: { tenants: Record<string, unknown>[] } }).data.tenants,
      ...(page2.data as { data: { tenants: Record<string, unknown>[] } }).data.tenants,
    ];
    for (const tenant of rawTenants) expect(tenant).not.toHaveProperty("setupPassword");
  });

  test.skip(`TC-ADMAPI-002 — search is partial, case-insensitive, Company-Name-only; totalCount reflects the filter [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const nameNeedle = `acme${Date.now().toString(36)}`;
    const emailNeedle = `mailonly${Date.now().toString(36)}`;
    const named = await createSetupTenant(client, adminToken, { name: `Widgets ${nameNeedle} Ltd` });
    const unnamed = await createSetupTenant(client, adminToken, {
      name: "Plain Tenant",
      domain: uniqueDomain(emailNeedle),
      ownerEmail: uniqueEmail(emailNeedle),
    });
    try {
      // Act + Assert — 2a partial lowercase
      const lower = await client.listTenants({ search: nameNeedle }, adminToken);
      assertResponseTime(lower);
      expect(lower.status).toBe(200);
      const lowerBody = TenantListEnvelopeSchema.parse(lower.data);
      expect(lowerBody.data.tenants.map((t) => t.id)).toEqual([named.tenant.id]);
      expect(lowerBody.data.pagination.totalCount).toBe(1);

      // 2b uppercase — case-insensitive
      const upper = await client.listTenants({ search: nameNeedle.toUpperCase() }, adminToken);
      assertResponseTime(upper);
      expect(upper.status).toBe(200);
      const upperBody = TenantListEnvelopeSchema.parse(upper.data);
      expect(upperBody.data.tenants.map((t) => t.id)).toEqual([named.tenant.id]);

      // 2c owner-email/domain fragment — only Company Name is searched → 0 results
      const emailSearch = await client.listTenants({ search: emailNeedle }, adminToken);
      assertResponseTime(emailSearch);
      expect(emailSearch.status).toBe(200);
      const emailBody = TenantListEnvelopeSchema.parse(emailSearch.data);
      expect(emailBody.data.tenants).toHaveLength(0);
      expect(emailBody.data.pagination.totalCount).toBe(0);
    } finally {
      await teardownTenant(named.tenant.id);
      await teardownTenant(unnamed.tenant.id);
    }
  });

  test(`TC-ADMAPI-003 — list boundaries: whitespace-only search, page=0, page past last, page omitted`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await signAdminToken({ sub: randomUUID() });
    const baseline = await client.listTenants({}, adminToken);
    assertResponseTime(baseline);
    expect(baseline.status).toBe(200);
    const baselineBody = TenantListEnvelopeSchema.parse(baseline.data);

    // 3a whitespace-only search = no filter
    const whitespace = await client.listTenants({ search: "  " }, adminToken);
    assertResponseTime(whitespace);
    expect(whitespace.status).toBe(200);
    const whitespaceBody = TenantListEnvelopeSchema.parse(whitespace.data);
    expect(whitespaceBody.data.pagination.totalCount).toBe(baselineBody.data.pagination.totalCount);

    // 3b page=0 — contract TBD (Gap #9): assert only that it is NOT served as a valid page 0 and no 5xx.
    const pageZero = await client.listTenants({ page: 0 }, adminToken);
    assertResponseTime(pageZero);
    expect(pageZero.status).toBeLessThan(500);
    if (pageZero.status === 200) {
      expect(TenantListEnvelopeSchema.parse(pageZero.data).data.pagination.page).not.toBe(0);
    }

    // 3c page far past the last — presumed 200 + empty array; contract TBD (Gap #9): assert no 5xx.
    const pastLast = await client.listTenants({ page: 99 }, adminToken);
    assertResponseTime(pastLast);
    expect(pastLast.status).toBeLessThan(500);
    if (pastLast.status === 200) {
      expect(TenantListEnvelopeSchema.parse(pastLast.data).data.tenants).toHaveLength(0);
    }

    // 3d page omitted → defaults to 1
    expect(baselineBody.data.pagination.page).toBe(1);
  });

  test.skip(`TC-ADMAPI-005 — search special characters are treated literally (no SQL-wildcard expansion, no 5xx) [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — a tenant whose Company Name literally contains % and _ .
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const marker = Date.now().toString(36);
    const literalName = `100% Freight_Co ${marker}`;
    const special = await createSetupTenant(client, adminToken, { name: literalName });

    try {
      // 5a/5b — '%' and '_' must match literally, not act as LIKE wildcards.
      for (const needle of ["%", "_"]) {
        const res = await client.listTenants({ search: needle }, adminToken);
        assertResponseTime(res);
        expect(res.status).toBe(200);
        const body = TenantListEnvelopeSchema.parse(res.data);
        // Our literal-named tenant qualifies; a wildcard-expansion bug would instead return the whole table.
        expect(body.data.tenants.some((t) => t.id === special.tenant.id)).toBe(true);
        expect(body.data.tenants.every((t) => t.name.includes(needle))).toBe(true);
      }

      // 5c/5d — quote and backslash are injection-shaped: safe handling → 200, no 5xx, no match.
      for (const needle of ["'", "\\"]) {
        const res = await client.listTenants({ search: needle }, adminToken);
        assertResponseTime(res);
        expect(res.status).toBeLessThan(500);
        expect(res.status).toBe(200);
        TenantListEnvelopeSchema.parse(res.data);
      }

      // 5e — a multi-token literal fragment still resolves the exact tenant.
      const combo = await client.listTenants({ search: `100% Freight` }, adminToken);
      assertResponseTime(combo);
      expect(combo.status).toBe(200);
      const comboBody = TenantListEnvelopeSchema.parse(combo.data);
      expect(comboBody.data.tenants.map((t) => t.id)).toContain(special.tenant.id);
    } finally {
      await teardownTenant(special.tenant.id);
    }
  });
});

// TC-ADMAPI-004-1..22 — endpoint (4a–4g) × token-variant (i–iii) guard checks.
// One explicit test case per combination (no data-driven .each — each data set is its own case).
interface EndpointProbe {
  endpoint: string;
  invoke: (client: AdminPortalClient, token?: string) => Promise<AxiosResponse>;
}
const AUTH_PROBE_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const endpointProbes: Record<string, EndpointProbe> = {
  "4a": { endpoint: "4a GET /admin/tenants", invoke: (c, t) => c.listTenants({}, t) },
  "4b": { endpoint: "4b POST /admin/tenants", invoke: (c, t) => c.createTenant(adminTenantCreatePayload(), t) },
  "4c": { endpoint: "4c GET /admin/tenants/:id", invoke: (c, t) => c.getTenantDetail(AUTH_PROBE_TENANT_ID, t) },
  "4d": { endpoint: "4d PATCH /admin/tenants/:id/company", invoke: (c, t) => c.updateCompany(AUTH_PROBE_TENANT_ID, companyUpdatePayload(), t) },
  "4e": { endpoint: "4e PATCH /admin/tenants/:id/status", invoke: (c, t) => c.updateStatus(AUTH_PROBE_TENANT_ID, { status: "active" }, t) },
  "4f": { endpoint: "4f PATCH /admin/tenants/:id/owner", invoke: (c, t) => c.updateOwner(AUTH_PROBE_TENANT_ID, ownerUpdatePayload(), t) },
  "4g": { endpoint: "4g POST /admin/tenants/:id/handover", invoke: (c, t) => c.triggerHandover(AUTH_PROBE_TENANT_ID, t) },
};
type TokenVariant = "i missing header" | "ii tampered JWT" | "iii tenant-pool JWT (wrong pool)";

async function assertGuardRejects401(probeKey: keyof typeof endpointProbes, variant: TokenVariant): Promise<void> {
  const client = new AdminPortalClient();
  let token: string | undefined;
  if (variant === "ii tampered JWT") token = jwtFactory.tamperedToken(await jwtFactory.adminToken());
  if (variant === "iii tenant-pool JWT (wrong pool)") {
    token = await jwtFactory.tenantToken({ tenantId: randomUUID(), roleId: randomUUID() });
  }

  const response = await endpointProbes[probeKey].invoke(client, token);

  assertResponseTime(response);
  expect(response.status).toBe(401);
  ErrorEnvelopeSchema.parse(response.data);
  assertErrorEnvelope(response, ERR_AUTH_INVALID_TOKEN);
}

describe("Admin Portal — auth guard contract (all 7 endpoints)", () => {
  test(`TC-ADMAPI-004-1 — 4a GET /admin/tenants with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4a", "i missing header"));
  test(`TC-ADMAPI-004-2 — 4a GET /admin/tenants with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4a", "ii tampered JWT"));
  test(`TC-ADMAPI-004-3 — 4a GET /admin/tenants with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4a", "iii tenant-pool JWT (wrong pool)"));
  test(`TC-ADMAPI-004-4 — 4b POST /admin/tenants with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4b", "i missing header"));
  test(`TC-ADMAPI-004-5 — 4b POST /admin/tenants with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4b", "ii tampered JWT"));
  test(`TC-ADMAPI-004-6 — 4b POST /admin/tenants with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4b", "iii tenant-pool JWT (wrong pool)"));
  test(`TC-ADMAPI-004-7 — 4c GET /admin/tenants/:id with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4c", "i missing header"));
  test(`TC-ADMAPI-004-8 — 4c GET /admin/tenants/:id with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4c", "ii tampered JWT"));
  test(`TC-ADMAPI-004-9 — 4c GET /admin/tenants/:id with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4c", "iii tenant-pool JWT (wrong pool)"));
  test(`TC-ADMAPI-004-10 — 4d PATCH /admin/tenants/:id/company with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4d", "i missing header"));
  test(`TC-ADMAPI-004-11 — 4d PATCH /admin/tenants/:id/company with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4d", "ii tampered JWT"));
  test(`TC-ADMAPI-004-12 — 4d PATCH /admin/tenants/:id/company with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4d", "iii tenant-pool JWT (wrong pool)"));
  test(`TC-ADMAPI-004-13 — 4e PATCH /admin/tenants/:id/status with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4e", "i missing header"));
  test(`TC-ADMAPI-004-14 — 4e PATCH /admin/tenants/:id/status with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4e", "ii tampered JWT"));
  test(`TC-ADMAPI-004-15 — 4e PATCH /admin/tenants/:id/status with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4e", "iii tenant-pool JWT (wrong pool)"));
  test(`TC-ADMAPI-004-16 — 4f PATCH /admin/tenants/:id/owner with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4f", "i missing header"));
  test(`TC-ADMAPI-004-17 — 4f PATCH /admin/tenants/:id/owner with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4f", "ii tampered JWT"));
  test(`TC-ADMAPI-004-18 — 4f PATCH /admin/tenants/:id/owner with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4f", "iii tenant-pool JWT (wrong pool)"));
  test(`TC-ADMAPI-004-19 — 4g POST /admin/tenants/:id/handover with i missing header → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4g", "i missing header"));
  test(`TC-ADMAPI-004-20 — 4g POST /admin/tenants/:id/handover with ii tampered JWT → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4g", "ii tampered JWT"));
  test(`TC-ADMAPI-004-21 — 4g POST /admin/tenants/:id/handover with iii tenant-pool JWT (wrong pool) → 401 ERR_AUTH_INVALID_TOKEN @smoke`, () => assertGuardRejects401("4g", "iii tenant-pool JWT (wrong pool)"));

  test(`TC-ADMAPI-004-22 — rejected unauthenticated create has no side effects @smoke`, async () => {
    const client = new AdminPortalClient();
    const payload = adminTenantCreatePayload();

    const response = await client.createTenant(payload); // no Authorization header

    expect(response.status).toBe(401);
    await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT count(*)::int AS n FROM tenants WHERE domain = $1", [payload.domain]);
      expect(rows[0].n).toBe(0);
    });
  });
});

describe("Admin Portal — POST /admin/tenants (create)", () => {
  test.skip(`TC-ADMAPI-010 — create: 201 contract, DB row, role seeding, users mirror, permanent Cognito password [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const payload = adminTenantCreatePayload();

    // Act
    const response = await client.createTenant(payload, adminToken);

    // Assert — status + echo + schema + spec-pinned defaults
    assertResponseTime(response);
    expect(response.status).toBe(201);
    const body = TenantDetailEnvelopeSchema.parse(response.data);
    assertRequestEchoedInResponse(payload, response);
    expect(body.data.status).toBe("inactive");
    expect(body.data.setupStatus).toBe("in_setup");
    expect(body.data.displayId).toMatch(DISPLAY_ID_PATTERN);
    expect(body.data.setupPassword).toBeTruthy();
    expect(body.data.setupCompletedAt).toBeNull();

    try {
      // DB: tenants row, 3 seeded roles, PO mirrored into users with the procurement_owner role.
      await withDbClient(async (db) => {
        const tenants = await db.query(
          "SELECT status, setup_status, owner_name, owner_email, setup_password_enc, setup_completed_at, display_id FROM tenants WHERE domain = $1",
          [payload.domain],
        );
        expect(tenants.rows).toHaveLength(1);
        expect(tenants.rows[0]).toMatchObject({
          status: "inactive",
          setup_status: "in_setup",
          owner_name: payload.ownerName,
          owner_email: payload.ownerEmail,
        });
        expect(tenants.rows[0].setup_password_enc).not.toBeNull();
        expect(tenants.rows[0].setup_completed_at).toBeNull();

        const roles = await db.query("SELECT name FROM roles WHERE tenant_id = $1", [body.data.id]);
        expect(roles.rows.map((r) => r.name).sort()).toEqual([
          "procurement_analyst",
          "procurement_manager",
          "procurement_owner",
        ]);

        const users = await db.query(
          "SELECT u.email, u.status, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.tenant_id = $1",
          [body.data.id],
        );
        expect(users.rows).toHaveLength(1);
        expect(users.rows[0]).toMatchObject({ email: payload.ownerEmail, status: "active", role_name: "procurement_owner" });
      });
      // TODO(qa, TC-ADMAPI-010 step 4): Cognito tenant-pool auth with ownerEmail + setupPassword must
      // succeed with NO NEW_PASSWORD_REQUIRED challenge (Permanent: true). Needs a Cognito auth helper
      // (local-env/localCognitoMock or AWS SDK) that this kit does not ship yet.
    } finally {
      await teardownTenant(body.data.id);
    }
  });

  // TC-ADMAPI-011-1..5 — one explicit test case per §5 domain-normalization variant (11a–11e).
  async function assertDuplicateDomainRejected(variantSub: string): Promise<void> {
    const variant = domainNormalizationVariants().find((v) => v.sub === variantSub);
    if (!variant) throw new Error(`Unknown domain-normalization variant: ${variantSub}`);

    // Arrange — a tenant already owns the bare base domain.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const baseDomain = uniqueDomain("dup");
    const base = await createSetupTenant(client, adminToken, { domain: baseDomain });
    const attempt = adminTenantCreatePayload({ domain: variant.value(baseDomain) });

    try {
      // Act
      const response = await client.createTenant(attempt, adminToken);

      // Assert — exact §4.2 409 contract
      assertResponseTime(response);
      expect(response.status).toBe(409);
      ErrorEnvelopeSchema.parse(response.data);
      assertErrorEnvelope(response, ERR_TENANT_DOMAIN_DUPLICATE);
      const err = response.data as ErrorEnvelope;
      expect(err.error.message).toBe(MSG_DOMAIN_DUPLICATE);
      expect(err.error.details).toHaveProperty("domain");

      // No tenant and no user were created for the rejected attempt.
      await withDbClient(async (db) => {
        const tenants = await db.query("SELECT count(*)::int AS n FROM tenants WHERE domain = $1", [baseDomain]);
        expect(tenants.rows[0].n).toBe(1);
        const users = await db.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [attempt.ownerEmail]);
        expect(users.rows[0].n).toBe(0);
      });
    } finally {
      await teardownTenant(base.tenant.id);
    }
  }

  test.skip(`TC-ADMAPI-011-1 — duplicate domain 11a bare domain → 409 ERR_TENANT_DOMAIN_DUPLICATE, nothing created [blocked: ${SKIP_REASON}] @smoke`, () => assertDuplicateDomainRejected("11a bare domain"));
  test.skip(`TC-ADMAPI-011-2 — duplicate domain 11b https + www → 409 ERR_TENANT_DOMAIN_DUPLICATE, nothing created [blocked: ${SKIP_REASON}] @smoke`, () => assertDuplicateDomainRejected("11b https + www"));
  test.skip(`TC-ADMAPI-011-3 — duplicate domain 11c www prefix → 409 ERR_TENANT_DOMAIN_DUPLICATE, nothing created [blocked: ${SKIP_REASON}] @smoke`, () => assertDuplicateDomainRejected("11c www prefix"));
  test.skip(`TC-ADMAPI-011-4 — duplicate domain 11d path + query → 409 ERR_TENANT_DOMAIN_DUPLICATE, nothing created [blocked: ${SKIP_REASON}] @smoke`, () => assertDuplicateDomainRejected("11d path + query"));
  test.skip(`TC-ADMAPI-011-5 — duplicate domain 11e port suffix → 409 ERR_TENANT_DOMAIN_DUPLICATE, nothing created [blocked: ${SKIP_REASON}] @smoke`, () => assertDuplicateDomainRejected("11e port suffix"));

  test.skip(`TC-ADMAPI-011-6 — stored value is the bare domain (protocol/www/path/query stripped) [blocked: ${SKIP_REASON}] @smoke`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const bare = uniqueDomain("zenith");
    const payload = adminTenantCreatePayload({ domain: `https://www.${bare}/home` });

    const response = await client.createTenant(payload, adminToken);

    assertResponseTime(response);
    expect(response.status).toBe(201);
    const body = TenantDetailEnvelopeSchema.parse(response.data);
    try {
      expect(body.data.domain).toBe(bare);
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT domain FROM tenants WHERE id = $1", [body.data.id]);
        expect(rows[0].domain).toBe(bare);
      });
    } finally {
      await teardownTenant(body.data.id);
    }
  });

  test.skip(`TC-ADMAPI-012 — duplicate owner email → 409 ERR_EMAIL_ALREADY_IN_USE (full-address match, not domain-level) [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — an existing user already holds the shared email.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const sharedEmail = uniqueEmail("shared");
    const first = await createSetupTenant(client, adminToken, { ownerEmail: sharedEmail });
    let secondTenantId: string | undefined;

    try {
      // 12a — same email, new unique domain → 409
      const dupAttempt = adminTenantCreatePayload({ ownerEmail: sharedEmail });
      const dup = await client.createTenant(dupAttempt, adminToken);
      assertResponseTime(dup);
      expect(dup.status).toBe(409);
      ErrorEnvelopeSchema.parse(dup.data);
      assertErrorEnvelope(dup, ERR_EMAIL_ALREADY_IN_USE);
      expect((dup.data as ErrorEnvelope).error.message).toBe(MSG_EMAIL_IN_USE);
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT count(*)::int AS n FROM tenants WHERE domain = $1", [dupAttempt.domain]);
        expect(rows[0].n).toBe(0);
      });

      // 12b — different address on the SAME email-domain (example.test) → 201; uniqueness is full-address.
      const sameDomainPayload = adminTenantCreatePayload({ ownerEmail: uniqueEmail("other") });
      const ok = await client.createTenant(sameDomainPayload, adminToken);
      assertResponseTime(ok);
      expect(ok.status).toBe(201);
      secondTenantId = TenantDetailEnvelopeSchema.parse(ok.data).data.id;
      assertRequestEchoedInResponse(sameDomainPayload, ok);
    } finally {
      await teardownTenant(first.tenant.id);
      if (secondTenantId) await teardownTenant(secondTenantId);
    }
  });

  // TC-ADMAPI-013-1..7 — one explicit test case per §5 validation sub-case (13a–13g).
  async function assertCreateValidationRejected(variantSub: string): Promise<void> {
    const variant = createValidationMatrix().find((v) => v.sub === variantSub);
    if (!variant) throw new Error(`Unknown create-validation sub-case: ${variantSub}`);
    const { overrides, invalidFields } = variant;

    const client = new AdminPortalClient();
    const adminToken = await signAdminToken({ sub: randomUUID() });
    const payload = adminTenantCreatePayload(overrides);

    const response = await client.createTenant(payload, adminToken);

    assertResponseTime(response);
    expect(response.status).toBe(400);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_VALIDATION_FAILED);
    expect((response.data as ErrorEnvelope).error.message).toBe(MSG_VALIDATION_FAILED);
    const fields = validationFields(response);
    for (const { field, message } of invalidFields) {
      expect(fields[field]).toBe(message);
    }
    // No side effects — the (valid, unique) domain of the rejected payload never lands in the DB.
    if (overrides.domain === undefined) {
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT count(*)::int AS n FROM tenants WHERE domain = $1", [payload.domain]);
        expect(rows[0].n).toBe(0);
      });
    }
  }

  test(`TC-ADMAPI-013-1 — 13a name empty → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13a name empty"));
  test(`TC-ADMAPI-013-2 — 13b domain empty → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13b domain empty"));
  test(`TC-ADMAPI-013-3 — 13c domain invalid format → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13c domain invalid format"));
  test(`TC-ADMAPI-013-4 — 13d address empty → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13d address empty"));
  test(`TC-ADMAPI-013-5 — 13e ownerName empty → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13e ownerName empty"));
  test(`TC-ADMAPI-013-6 — 13f ownerEmail invalid → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13f ownerEmail invalid"));
  test(`TC-ADMAPI-013-7 — 13g multiple invalid fields → 400 ERR_VALIDATION_FAILED with exact §5 per-field message`, () => assertCreateValidationRejected("13g multiple invalid fields"));

  // TC-ADMAPI-014-1..10 — one explicit test case per §5 max-length boundary (at/over limit × 5 fields).
  async function assertMaxLengthBoundary(variantSub: string): Promise<void> {
    const variant = maxLengthBoundaryMatrix().find((v) => v.sub === variantSub);
    if (!variant) throw new Error(`Unknown max-length boundary sub-case: ${variantSub}`);
    const { field, length, expectAccept, overLimitMessage } = variant;

    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const payload = adminTenantCreatePayload();
    payload[field] = boundaryValueFor(field, length);
    expect(payload[field]).toHaveLength(length); // builder sanity

    const response = await client.createTenant(payload, adminToken);

    assertResponseTime(response);
    if (expectAccept) {
      // Note (TC-ADMAPI-014): 320-char emails may be rejected by Cognito itself — if so, record
      // the actual behavior and flag to the PM; do not weaken this assertion silently.
      expect(response.status).toBe(201);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      assertRequestEchoedInResponse(payload, response);
      await teardownTenant(body.data.id);
    } else {
      expect(response.status).toBe(400);
      ErrorEnvelopeSchema.parse(response.data);
      assertErrorEnvelope(response, ERR_VALIDATION_FAILED);
      expect(validationFields(response)[field]).toBe(overLimitMessage);
    }
  }

  test.skip(`TC-ADMAPI-014-1 — name at limit (255) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("name at limit (255)"));
  test.skip(`TC-ADMAPI-014-2 — name over limit (256) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("name over limit (256)"));
  test.skip(`TC-ADMAPI-014-3 — domain at limit (255) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("domain at limit (255)"));
  test.skip(`TC-ADMAPI-014-4 — domain over limit (256) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("domain over limit (256)"));
  test.skip(`TC-ADMAPI-014-5 — address at limit (500) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("address at limit (500)"));
  test.skip(`TC-ADMAPI-014-6 — address over limit (501) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("address over limit (501)"));
  test.skip(`TC-ADMAPI-014-7 — ownerName at limit (255) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("ownerName at limit (255)"));
  test.skip(`TC-ADMAPI-014-8 — ownerName over limit (256) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("ownerName over limit (256)"));
  test.skip(`TC-ADMAPI-014-9 — ownerEmail at limit (320) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("ownerEmail at limit (320)"));
  test.skip(`TC-ADMAPI-014-10 — ownerEmail over limit (321) [blocked: ${SKIP_REASON}]`, () => assertMaxLengthBoundary("ownerEmail over limit (321)"));

  test.skip(`TC-ADMAPI-015 — setup password stored encrypted; audit snapshot strips it [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — chains with TC-ADMAPI-010: create a tenant and hold the plaintext setupPassword.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);
    const plaintext = tenant.setupPassword;
    expect(plaintext).toBeTruthy();

    try {
      await withDbClient(async (db) => {
        const enc = await db.query("SELECT setup_password_enc FROM tenants WHERE id = $1", [tenant.id]);
        const stored = enc.rows[0].setup_password_enc as string | null;
        expect(stored).not.toBeNull();
        expect(stored).not.toBe(plaintext);
        expect(String(stored)).not.toContain(String(plaintext));

        const audit = await db.query(
          "SELECT snapshot FROM platform_audit_logs WHERE entity = 'tenants' AND entity_id = $1 ORDER BY created_at DESC",
          [tenant.id],
        );
        expect(audit.rows.length).toBeGreaterThanOrEqual(1);
        for (const row of audit.rows) {
          const snapshotJson = JSON.stringify(row.snapshot ?? {});
          expect(snapshotJson).not.toContain("setup_password_enc");
          expect(snapshotJson).not.toContain(String(plaintext));
        }
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMCREATE-008 — unicode and special characters accepted in text fields within limits [blocked: ${SKIP_REASON}]`, async () => {
    // §5 only constrains name/ownerName/address by non-empty + max length — no charset rule.
    // If the backend rejects any charset, that is an undocumented rule — file as spec gap, not a failure.
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const payload = adminTenantCreatePayload({
      name: UNICODE_COMPANY_NAME,
      ownerName: UNICODE_OWNER_NAME,
      address: UNICODE_ADDRESS,
    });

    const response = await client.createTenant(payload, adminToken);

    assertResponseTime(response);
    expect(response.status).toBe(201);
    const body = TenantDetailEnvelopeSchema.parse(response.data);
    try {
      // Echoed byte-identical — no mangling/stripping.
      expect(body.data.name).toBe(UNICODE_COMPANY_NAME);
      expect(body.data.ownerName).toBe(UNICODE_OWNER_NAME);
      expect(body.data.address).toBe(UNICODE_ADDRESS);

      // Detail round-trip intact.
      const detail = await client.getTenantDetail(body.data.id, adminToken);
      assertResponseTime(detail);
      expect(detail.status).toBe(200);
      const detailBody = TenantDetailEnvelopeSchema.parse(detail.data);
      expect(detailBody.data.name).toBe(UNICODE_COMPANY_NAME);

      // List round-trip intact (partial-name search).
      const list = await client.listTenants({ search: "Müller" }, adminToken);
      assertResponseTime(list);
      expect(list.status).toBe(200);
      const listBody = TenantListEnvelopeSchema.parse(list.data);
      const item = listBody.data.tenants.find((t) => t.id === body.data.id);
      expect(item?.name).toBe(UNICODE_COMPANY_NAME);
    } finally {
      await teardownTenant(body.data.id);
    }
  });
});

describe("Admin Portal — GET /admin/tenants/:id (detail)", () => {
  test.skip(`TC-ADMAPI-020 — detail returns decrypted setupPassword only while in_setup [blocked: ${SKIP_REASON}] @smoke`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);

    try {
      const response = await client.getTenantDetail(tenant.id, adminToken);

      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.setupPassword).toBe(tenant.setupPassword); // decryption round-trip
      expect(body.data.setupCompletedAt).toBeNull();
      expect(body.data.status).toBe("inactive");
      expect(body.data.setupStatus).toBe("in_setup");
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-021 — detail after handover: setupPassword null/omitted; setupCompletedAt populated [blocked: ${SKIP_REASON}] @smoke`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createHandedOverTenant(client, adminToken);

    try {
      const response = await client.getTenantDetail(tenant.id, adminToken);

      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      expect(body.data.setupPassword ?? null).toBeNull(); // null or absent
      expect(body.data.setupCompletedAt).not.toBeNull(); // valid ISO timestamp per schema
      expect(body.data.status).toBe("active");
      expect(body.data.setupStatus).toBe("handed_over");
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-022 — detail 404 for unknown and soft-deleted tenants; malformed id is not a 5xx [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();

    // 22a — unknown UUID
    const unknown = await client.getTenantDetail(randomUUID(), adminToken);
    assertResponseTime(unknown);
    expect(unknown.status).toBe(404);
    ErrorEnvelopeSchema.parse(unknown.data);
    assertErrorEnvelope(unknown, ERR_NOT_FOUND);
    expect((unknown.data as ErrorEnvelope).error.message).toBe(MSG_TENANT_NOT_FOUND);
    expect((unknown.data as ErrorEnvelope).error.details).toEqual({});

    // 22b — soft-deleted tenant (mechanism is F1-owned; seeded directly in the DB).
    const { tenant } = await createSetupTenant(client, adminToken);
    try {
      await withDbClient((db) => db.query("UPDATE tenants SET deleted_at = now() WHERE id = $1", [tenant.id]));
      const softDeleted = await client.getTenantDetail(tenant.id, adminToken);
      expect(softDeleted.status).toBe(404);
      assertErrorEnvelope(softDeleted, ERR_NOT_FOUND);

      // 22c — non-UUID path param: 400 vs 404 is contract TBD (Gap #10); assert no 5xx.
      const malformed = await client.getTenantDetail("abc", adminToken);
      expect(malformed.status).toBeLessThan(500);
      expect([400, 404]).toContain(malformed.status);
    } finally {
      await teardownTenant(tenant.id);
    }
  });
});

describe("Admin Portal — PATCH /admin/tenants/:id/company", () => {
  test.skip(`TC-ADMAPI-030 — company update: 200, row updated, no owner/status side effects, created_at stable [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);
    const createdAtBefore = await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT created_at FROM tenants WHERE id = $1", [tenant.id]);
      return rows[0].created_at as Date;
    });
    const patch = companyUpdatePayload();

    try {
      // Act
      const response = await client.updateCompany(tenant.id, patch, adminToken);

      // Assert
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = TenantDetailEnvelopeSchema.parse(response.data);
      assertRequestEchoedInResponse(patch, response);
      expect(body.data.ownerName).toBe(tenant.ownerName);
      expect(body.data.ownerEmail).toBe(tenant.ownerEmail);
      expect(body.data.status).toBe(tenant.status);
      expect(body.data.setupStatus).toBe(tenant.setupStatus);

      // Read-after-write persistence + created_at unchanged (US-2.1 ordering stability).
      const detail = await client.getTenantDetail(tenant.id, adminToken);
      expect(detail.status).toBe(200);
      assertRequestEchoedInResponse(patch, detail);
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT name, domain, address, created_at FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0]).toMatchObject({ name: patch.name, domain: patch.domain, address: patch.address });
        expect(new Date(rows[0].created_at).toISOString()).toBe(new Date(createdAtBefore).toISOString());
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-031 — company domain uniqueness excludes self (incl. pre-normalization self variant) [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const a = await createSetupTenant(client, adminToken);
    const b = await createSetupTenant(client, adminToken);

    try {
      // 31a — B takes A's domain → 409
      const conflict = await client.updateCompany(b.tenant.id, companyUpdatePayload({ domain: a.tenant.domain }), adminToken);
      assertResponseTime(conflict);
      expect(conflict.status).toBe(409);
      ErrorEnvelopeSchema.parse(conflict.data);
      assertErrorEnvelope(conflict, ERR_TENANT_DOMAIN_DUPLICATE);
      expect((conflict.data as ErrorEnvelope).error.message).toBe(MSG_DOMAIN_DUPLICATE);

      // 31b — B keeps its own domain → 200 (self excluded)
      const self = await client.updateCompany(b.tenant.id, companyUpdatePayload({ domain: b.tenant.domain }), adminToken);
      assertResponseTime(self);
      expect(self.status).toBe(200);
      TenantDetailEnvelopeSchema.parse(self.data);

      // 31c — "www." + own domain → 200 (normalization runs before the self-check)
      const wwwSelf = await client.updateCompany(
        b.tenant.id,
        companyUpdatePayload({ domain: `www.${b.tenant.domain}` }),
        adminToken,
      );
      assertResponseTime(wwwSelf);
      expect(wwwSelf.status).toBe(200);
      expect(TenantDetailEnvelopeSchema.parse(wwwSelf.data).data.domain).toBe(b.tenant.domain);
    } finally {
      await teardownTenant(a.tenant.id);
      await teardownTenant(b.tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-032 — company update negatives: validation 400 (exact §5 messages) and 404 [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken);

    try {
      // 32a — empty name
      const emptyName = await client.updateCompany(tenant.id, companyUpdatePayload({ name: "" }), adminToken);
      assertResponseTime(emptyName);
      expect(emptyName.status).toBe(400);
      assertErrorEnvelope(emptyName, ERR_VALIDATION_FAILED);
      expect(validationFields(emptyName).name).toBe(FIELD_MESSAGES.nameRequired);

      // 32b — address 501 chars (limit 500)
      const longAddress = await client.updateCompany(
        tenant.id,
        companyUpdatePayload({ address: boundaryValueFor("address", FIELD_LIMITS.address + 1) }),
        adminToken,
      );
      assertResponseTime(longAddress);
      expect(longAddress.status).toBe(400);
      assertErrorEnvelope(longAddress, ERR_VALIDATION_FAILED);
      expect(validationFields(longAddress).address).toBe(FIELD_MESSAGES.addressMax);

      // Row unchanged after both rejections.
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT name, address FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0]).toMatchObject({ name: tenant.name, address: tenant.address });
      });

      // 32c — unknown tenant UUID with a valid body → 404
      const notFound = await client.updateCompany(randomUUID(), companyUpdatePayload(), adminToken);
      assertResponseTime(notFound);
      expect(notFound.status).toBe(404);
      assertErrorEnvelope(notFound, ERR_NOT_FOUND);
    } finally {
      await teardownTenant(tenant.id);
    }
  });
});

describe("Admin Portal — PATCH /admin/tenants/:id/status", () => {
  test.skip(`TC-ADMAPI-040 — post-handover status toggle: active ↔ inactive both directions; setupStatus stays handed_over [blocked: ${SKIP_REASON}] @smoke`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createHandedOverTenant(client, adminToken); // handed over ⇒ active

    try {
      // 40a — deactivate
      const deactivate = await client.updateStatus(tenant.id, { status: "inactive" }, adminToken);
      assertResponseTime(deactivate);
      expect(deactivate.status).toBe(200);
      const deactivated = TenantDetailEnvelopeSchema.parse(deactivate.data);
      expect(deactivated.data.status).toBe("inactive");
      expect(deactivated.data.setupStatus).toBe("handed_over");
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT status FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0].status).toBe("inactive");
      });

      // 40b — reactivate
      const activate = await client.updateStatus(tenant.id, { status: "active" }, adminToken);
      assertResponseTime(activate);
      expect(activate.status).toBe(200);
      const activated = TenantDetailEnvelopeSchema.parse(activate.data);
      expect(activated.data.status).toBe("active");
      expect(activated.data.setupStatus).toBe("handed_over");
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT status, setup_status FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0]).toMatchObject({ status: "active", setup_status: "handed_over" });
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-041 — activating a Setup tenant rejected: 409 ERR_INVALID_STATE_TRANSITION (server-side lock, not UI-only) [blocked: ${SKIP_REASON}] @smoke`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createSetupTenant(client, adminToken); // in_setup / inactive

    try {
      const response = await client.updateStatus(tenant.id, { status: "active" }, adminToken);

      assertResponseTime(response);
      expect(response.status).toBe(409);
      ErrorEnvelopeSchema.parse(response.data);
      assertErrorEnvelope(response, ERR_INVALID_STATE_TRANSITION);
      const err = response.data as ErrorEnvelope;
      expect(err.error.message).toBe(MSG_CANNOT_ACTIVATE_IN_SETUP);
      expect(err.error.details).toMatchObject({ currentSetupStatus: "in_setup" });

      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT status, setup_status FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0]).toMatchObject({ status: "inactive", setup_status: "in_setup" });
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });

  test.skip(`TC-ADMAPI-042 — status negatives: invalid value ("archived", ""), unknown tenant [blocked: ${SKIP_REASON}]`, async () => {
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();
    const { tenant } = await createHandedOverTenant(client, adminToken);

    try {
      // 42a/42b — value outside the {"active","inactive"} enum.
      // Note: exact error code not shown in §4.2 examples — ERR_VALIDATION_FAILED inferred from §9; flag if actual differs.
      for (const invalid of ["archived", ""]) {
        const response = await client.updateStatus(tenant.id, { status: invalid }, adminToken);
        assertResponseTime(response);
        expect(response.status).toBe(400);
        ErrorEnvelopeSchema.parse(response.data);
        assertErrorEnvelope(response, ERR_VALIDATION_FAILED);
      }
      // Row unchanged.
      await withDbClient(async (db) => {
        const { rows } = await db.query("SELECT status FROM tenants WHERE id = $1", [tenant.id]);
        expect(rows[0].status).toBe("active");
      });

      // 42c — unknown tenant with a valid body
      const notFound = await client.updateStatus(randomUUID(), { status: "inactive" }, adminToken);
      assertResponseTime(notFound);
      expect(notFound.status).toBe(404);
      assertErrorEnvelope(notFound, ERR_NOT_FOUND);
    } finally {
      await teardownTenant(tenant.id);
    }
  });
});

describe("Admin Portal — audit-log capture across mutating endpoints", () => {
  /** New platform_audit_logs rows for this tenant since a prior baseline count. */
  async function auditCount(tenantId: string): Promise<number> {
    return withDbClient(async (db) => {
      const { rows } = await db.query(
        "SELECT count(*)::int AS n FROM platform_audit_logs WHERE entity = 'tenants' AND entity_id = $1",
        [tenantId],
      );
      return rows[0].n as number;
    });
  }

  test.skip(`TC-ADMAPI-006 — every mutating endpoint writes a platform_audit_logs row (no setup_password_enc in snapshots) [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Global Assumptions + Tech §2: all admin DB writes are captured by the F1 interceptor into
    // platform_audit_logs (routed to platform, not tenant, because request.adminPrincipal exists).
    const client = new AdminPortalClient();
    const adminToken = await jwtFactory.adminToken();

    // 6a — POST create (createSetupTenant issues the create) leaves ≥ 1 audit row.
    const { tenant } = await createSetupTenant(client, adminToken);
    try {
      const afterCreate = await auditCount(tenant.id);
      expect(afterCreate).toBeGreaterThanOrEqual(1);

      // 6b — PATCH company
      const company = await client.updateCompany(tenant.id, companyUpdatePayload(), adminToken);
      expect(company.status).toBe(200);
      const afterCompany = await auditCount(tenant.id);
      expect(afterCompany).toBeGreaterThan(afterCreate);

      // 6c — PATCH owner (name-only)
      const owner = await client.updateOwner(tenant.id, ownerUpdatePayload({ email: tenant.ownerEmail }), adminToken);
      expect(owner.status).toBe(200);
      const afterOwner = await auditCount(tenant.id);
      expect(afterOwner).toBeGreaterThan(afterCompany);

      // 6e — POST handover (also flips status → active); after this the status toggle is allowed.
      const handover = await client.triggerHandover(tenant.id, adminToken);
      expect(handover.status).toBe(200);
      const afterHandover = await auditCount(tenant.id);
      expect(afterHandover).toBeGreaterThan(afterOwner);

      // 6d — PATCH status (post-handover deactivate)
      const status = await client.updateStatus(tenant.id, { status: "inactive" }, adminToken);
      expect(status.status).toBe(200);
      const afterStatus = await auditCount(tenant.id);
      expect(afterStatus).toBeGreaterThan(afterHandover);

      // Snapshots must never carry the encrypted setup password (F1 §13.3 strip, re-checked across endpoints).
      await withDbClient(async (db) => {
        const audit = await db.query(
          "SELECT snapshot FROM platform_audit_logs WHERE entity = 'tenants' AND entity_id = $1",
          [tenant.id],
        );
        for (const row of audit.rows) {
          expect(JSON.stringify(row.snapshot ?? {})).not.toContain("setup_password_enc");
        }
      });
    } finally {
      await teardownTenant(tenant.id);
    }
  });
});
