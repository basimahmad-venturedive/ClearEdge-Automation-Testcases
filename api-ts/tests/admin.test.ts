/**
 * TC-ADMIN-001..005 — Platform Admin control-plane isolation.
 * Spec: §8.1, §9 (SR-010, SR-011, SR-018), §5.4, §13.2, §7.3 BR-04 exception. Blocked — see tests/auth.test.ts header.
 */
import { describe, test, expect } from "vitest";
import { ControlPlaneClient, TODO_ENDPOINT_TENANT_DETAIL, ENDPOINT_TENANT_CREATE, TODO_ENDPOINT_AUDIT_TENANT } from "../src/clients/controlPlaneClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
import { withDbClient } from "../src/utils/dbClient";
import { tenantCreationPayload } from "../src/payloads/identityRbacPayloads";
import type { ErrorEnvelope } from "../src/payloads/types";

const NO_ENV_REASON = "no environment exists yet — see TC-ADMIN-* in TC-CEIQ-FOUND-001.md §9";
const jwtFactory = new JwtFactory();

describe("Platform Admin isolation", () => {
  test.skip(`TC-ADMIN-001 — PA control-plane action succeeds and is audited (SR-010) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    const response = await client.get(TODO_ENDPOINT_TENANT_DETAIL("some-tenant-id"), adminToken);
    expect(response.status).toBe(200);
    await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT count(*) FROM platform_audit_logs WHERE table_name = 'tenants'");
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
    });
  });

  test.skip(`TC-ADMIN-002 — PA denied business-data access (SR-011, BR-04) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    const response = await client.get("/TODO/fixture-table/some-business-record", adminToken);
    expect(response.status).toBe(403);
    expect((response.data as ErrorEnvelope).error.code).toBe("ERR_RBAC_FORBIDDEN");
  });

  test.skip(`TC-ADMIN-003 — PA cannot read tenant_audit_logs (SR-018, BR-20) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    const response = await client.get(TODO_ENDPOINT_AUDIT_TENANT, adminToken);
    expect(response.status).toBe(403);
  });

  test.skip(`TC-ADMIN-004 — PA write to users routes to platform_audit_logs, not tenant (§5.4, §13.2) [blocked: ${NO_ENV_REASON}] @smoke`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    await client.post(ENDPOINT_TENANT_CREATE, tenantCreationPayload(), adminToken);
    await withDbClient(async (db) => {
      const tenantAudit = await db.query(
        "SELECT count(*) FROM tenant_audit_logs WHERE table_name = 'users' AND actor_sub = $1",
        [adminToken],
      );
      const platformAudit = await db.query("SELECT count(*) FROM platform_audit_logs WHERE table_name = 'users'");
      expect(Number(tenantAudit.rows[0].count)).toBe(0);
      expect(Number(platformAudit.rows[0].count)).toBeGreaterThanOrEqual(1);
    });
  });

  test.skip(`TC-ADMIN-005 — setup-phase PA-as-PO writes attributed to PO in tenant_audit_logs (§7.3, BR-04 exception) [blocked: ${NO_ENV_REASON}]`, async () => {
    // Arrange: tenant in setup_status='in_setup'; PA authenticated as the PO (tenant-pool session, not adminPrincipal).
    await withDbClient(async (db) => {
      const { rows } = await db.query(
        "SELECT count(*) FROM tenant_audit_logs WHERE created_at < (SELECT setup_completed_at FROM tenants WHERE id = $1)",
        ["some-tenant-id"],
      );
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(0); // exact assertion depends on fixture seeding once environment exists
    });
  });
});
