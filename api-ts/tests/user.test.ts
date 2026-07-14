/**
 * TC-USER-001..013 — user lifecycle: provisioning, deactivation, reactivation,
 * email/role change, PO reassignment.
 * Spec: §7.3-7.9, §9 (SR-015, SR-019), US-RBAC-002/003, BR-06..14, BR-22..25. Blocked — see tests/auth.test.ts header.
 */
import { describe, test, expect } from "vitest";
import { ControlPlaneClient, TODO_ENDPOINT_USER_CREATE, TODO_ENDPOINT_USER_DETAIL, TODO_ENDPOINT_USER_LIST, TODO_ENDPOINT_PO_REASSIGN } from "../src/clients/controlPlaneClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
import { withDbClient } from "../src/utils/dbClient";
import { userCreationPayload } from "../src/payloads/identityRbacPayloads";
import { assertRequestEchoedInResponse, assertResponseTime } from "../src/utils/assertions";
import type { ErrorEnvelope, SuccessEnvelope, UserResponse } from "../src/payloads/types";

const NO_ENV_REASON = "no environment exists yet — see TC-USER-* in TC-CEIQ-FOUND-001.md §9";
const SENDGRID_REASON = `${NO_ENV_REASON} — SendGrid dispatch also needs a test-sandbox decision (Partial automation)`;
const jwtFactory = new JwtFactory();

describe("User lifecycle", () => {
  test.skip.each((["procurement_manager", "procurement_analyst"] as const).map((role, i) => ({ role, tc: `TC-USER-001-${String(i + 1).padStart(2, "0")}` })))(
    `$tc — PO creates role=$role, active immediately, notification email sent (US-RBAC-003 AC-001) [blocked: ${SENDGRID_REASON}] @smoke`,
    async ({ role }) => {
      const client = new ControlPlaneClient();
      const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
      const payload = userCreationPayload({ role });
      const response = await client.post<SuccessEnvelope<UserResponse>>(TODO_ENDPOINT_USER_CREATE, payload, ownerToken);
      assertResponseTime(response);
      expect(response.status).toBe(201);
      assertRequestEchoedInResponse(payload, response);
      expect(response.data.data.status).toBe("active");
    },
  );

  test.skip(`TC-USER-002 — PO-initiated creation with role=procurement_owner rejected (BR-11) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    const payload = userCreationPayload({ role: "procurement_owner" });
    const response = await client.post(TODO_ENDPOINT_USER_CREATE, payload, ownerToken);
    expect(response.status).not.toBe(201); // exact code unconfirmed — Clarification Question in TC file
  });

  test.skip(`TC-USER-003 — PO edits a user's name/role, updates immediately (US-RBAC-003 AC-003) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    const response = await client.patch<SuccessEnvelope<UserResponse>>(TODO_ENDPOINT_USER_DETAIL("some-user-id"), { name: "Updated Name" }, ownerToken);
    expect(response.status).toBe(200);
    expect(response.data.data.name).toBe("Updated Name");
  });

  test.skip(`TC-USER-004 — PO changes a user's email, old loses access, new invite sent (US-RBAC-003 AC-004, §7.8) [blocked: ${SENDGRID_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    const response = await client.patch<SuccessEnvelope<UserResponse>>(
      TODO_ENDPOINT_USER_DETAIL("some-user-id"),
      { email: "new.address@example.test", confirm: true },
      ownerToken,
    );
    expect(response.status).toBe(200);
    expect(response.data.data.email).toBe("new.address@example.test");
  });

  test.skip(`TC-USER-005 — PO deactivates an active user, immediate loss of access, reversible (US-RBAC-003 AC-005, §7.6) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    const response = await client.patch(TODO_ENDPOINT_USER_DETAIL("some-user-id"), { status: "inactive" }, ownerToken);
    expect(response.status).toBe(200);
    await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT status FROM users WHERE id = $1", ["some-user-id"]);
      expect(rows[0].status).toBe("inactive");
    });
  });

  test.skip(`TC-USER-006 — PO reactivates an inactive user, immediate regain, no confirmation (US-RBAC-003 AC-006, §7.7) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    const response = await client.patch<SuccessEnvelope<UserResponse>>(TODO_ENDPOINT_USER_DETAIL("some-user-id"), { status: "active" }, ownerToken);
    expect(response.status).toBe(200);
    expect(response.data.data.status).toBe("active");
  });

  test.skip(`TC-USER-007 — PO's user list excludes own profile, shows only Manager/Analyst of their tenant (US-RBAC-003 AC-007) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner", sub: "owner-sub" });
    const response = await client.get<SuccessEnvelope<UserResponse[]>>(TODO_ENDPOINT_USER_LIST, ownerToken);
    expect(response.status).toBe(200);
    const listedIds = response.data.data.map((u) => u.id);
    expect(listedIds).not.toContain("owner-sub");
  });

  test.skip(`TC-USER-008 — PO cannot deactivate their own account (US-RBAC-003 AC-009, SR-015) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner", sub: "owner-sub" });
    const response = await client.patch(TODO_ENDPOINT_USER_DETAIL("owner-sub"), { status: "inactive" }, ownerToken);
    expect(response.status).toBe(403);
    expect((response.data as ErrorEnvelope).error.code).toBe("ERR_OWNER_SELF_DEACTIVATION");
  });

  test.skip(`TC-USER-009 — email already in use in another tenant rejected (BR-24) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "tenant-b", roleId: "role-owner" });
    const payload = userCreationPayload({ email: "taken@example.test" }); // already exists in tenant-a per fixture
    const response = await client.post(TODO_ENDPOINT_USER_CREATE, payload, ownerToken);
    expect(response.status).toBe(409);
    expect((response.data as ErrorEnvelope).error.code).toBe("ERR_EMAIL_ALREADY_IN_USE");
  });

  test.skip(`TC-USER-010 — PO reassignment deactivates old owner, creates new, audits to platform (SR-019, §7.4) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    const response = await client.patch(TODO_ENDPOINT_PO_REASSIGN("some-tenant-id"), { name: "New PO", email: "new.po@example.test" }, adminToken);
    expect(response.status).toBe(200);
    await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT status FROM users WHERE id = $1", ["old-po-id"]);
      expect(rows[0].status).toBe("inactive");
    });
  });

  test.skip(`TC-USER-011 — reassignment during in_setup generates setup password, no invite email (§7.4 step 4) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    const response = await client.patch<SuccessEnvelope<Record<string, unknown>>>(
      TODO_ENDPOINT_PO_REASSIGN("in-setup-tenant-id"),
      { name: "New PO", email: "new.po2@example.test" },
      adminToken,
    );
    expect(response.status).toBe(200);
    expect(response.data.data).toHaveProperty("setupPassword"); // displayed on screen per spec
  });

  test.skip(`TC-USER-012 — reassignment during handed_over sends invite email (§7.4 step 4) [blocked: ${SENDGRID_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    const response = await client.patch<SuccessEnvelope<Record<string, unknown>>>(
      TODO_ENDPOINT_PO_REASSIGN("handed-over-tenant-id"),
      { name: "New PO", email: "new.po3@example.test" },
      adminToken,
    );
    expect(response.status).toBe(200);
    expect(response.data.data).not.toHaveProperty("setupPassword");
  });

  test.skip(`TC-USER-013 — Cognito write first; no users mirror on Cognito failure (§7.3/§7.5 ordering) [blocked: ${NO_ENV_REASON} — requires mocking the Cognito SDK]`, () => {
    throw new Error("requires mocking the Cognito SDK client — scaffolded, not yet implemented");
  });
});
