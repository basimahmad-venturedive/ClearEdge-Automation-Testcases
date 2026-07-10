/**
 * TC-AUDIT-001..006 — ORM-level audit interceptor.
 * Spec: §5.3, §9 (SR-013), §13, BR-17..21. Blocked — see tests/auth.test.ts header.
 */
import { describe, test, expect } from "vitest";
import { ControlPlaneClient, ENDPOINT_TENANT_CREATE } from "../src/clients/controlPlaneClient";
import { JwtFactory } from "../src/utils/jwtHelpers";
import { withDbClient } from "../src/utils/dbClient";
import { tenantCreationPayload } from "../src/payloads/identityRbacPayloads";

const NO_ENV_REASON = "no environment exists yet — see TC-AUDIT-* in TC-CEIQ-FOUND-001.md §9";
const jwtFactory = new JwtFactory();

describe("Audit logging", () => {
  test.skip(`TC-AUDIT-001 — write captured with full actor/action/table/record/old/new state (SR-013) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    await client.patch("/TODO/tenant/users/some-user-id", { name: "New Name" }, ownerToken);
    await withDbClient(async (db) => {
      const { rows } = await db.query(
        `SELECT action, table_name, new_state FROM tenant_audit_logs
         WHERE table_name = 'users' AND record_id = $1 ORDER BY created_at DESC LIMIT 1`,
        ["some-user-id"],
      );
      expect(rows[0].action).toBe("UPDATE");
      expect(rows[0].new_state.name).toBe("New Name");
    });
  });

  test.skip(`TC-AUDIT-002 — sensitive fields stripped from audit snapshots (SR-013, BR-21) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    await client.post(ENDPOINT_TENANT_CREATE, tenantCreationPayload(), adminToken);
    await withDbClient(async (db) => {
      const { rows } = await db.query(
        "SELECT old_state, new_state FROM platform_audit_logs WHERE table_name = 'tenants' ORDER BY created_at DESC LIMIT 1",
      );
      for (const state of [rows[0].old_state, rows[0].new_state]) {
        if (state) expect(state).not.toHaveProperty("setup_password_enc");
      }
    });
  });

  test.skip(`TC-AUDIT-003 — adminPrincipal writes route to platform_audit_logs (§13.2) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const adminToken = await jwtFactory.adminToken();
    await client.post(ENDPOINT_TENANT_CREATE, tenantCreationPayload(), adminToken);
    await withDbClient(async (db) => {
      const { rows } = await db.query("SELECT count(*) FROM platform_audit_logs WHERE table_name = 'tenants'");
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
    });
  });

  test.skip(`TC-AUDIT-004 — principal-only writes route to tenant_audit_logs (§13.2) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const ownerToken = await jwtFactory.tenantToken({ tenantId: "t1", roleId: "role-owner" });
    await client.patch("/TODO/tenant/users/some-user-id", { name: "Y" }, ownerToken);
    await withDbClient(async (db) => {
      const { rows } = await db.query(
        "SELECT count(*) FROM tenant_audit_logs WHERE table_name = 'users' AND tenant_id = 't1'",
      );
      expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
    });
  });

  test.skip(`TC-AUDIT-005 — audit rows are append-only (§5.3) [blocked: ${NO_ENV_REASON} — better verified by a static code check; runtime test is Partial]`, () => {
    throw new Error("Partial automation — pair with a static grep-based check per TC notes");
  });

  test.skip(`TC-AUDIT-006 — non-write security events not audited (§13.4) [blocked: ${NO_ENV_REASON}]`, async () => {
    const client = new ControlPlaneClient();
    const before = await withDbClient(async (db) => {
      const t = await db.query("SELECT count(*) FROM tenant_audit_logs");
      const p = await db.query("SELECT count(*) FROM platform_audit_logs");
      return { tenant: Number(t.rows[0].count), platform: Number(p.rows[0].count) };
    });

    const badToken = jwtFactory.tamperedToken(await jwtFactory.tenantToken());
    await client.get("/TODO/any-protected-route", badToken); // 401

    const after = await withDbClient(async (db) => {
      const t = await db.query("SELECT count(*) FROM tenant_audit_logs");
      const p = await db.query("SELECT count(*) FROM platform_audit_logs");
      return { tenant: Number(t.rows[0].count), platform: Number(p.rows[0].count) };
    });

    expect(after.tenant).toBe(before.tenant);
    expect(after.platform).toBe(before.platform);
  });
});
