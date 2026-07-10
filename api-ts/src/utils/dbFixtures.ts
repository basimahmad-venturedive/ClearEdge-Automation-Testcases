/**
 * DB fixture helpers for tests that exercise the real clearedge-backend locally.
 *
 * POST /api/v1/tenants (the only way to create a tenant/user through the API) calls
 * the real AWS Cognito SDK (CognitoAdminService) — which fails locally with
 * ERR_COGNITO_OPERATION_FAILED since no real Cognito pool exists (confirmed 2026-07-08).
 * These fixtures insert directly into Postgres — bypassing Cognito entirely — so guard
 * and RLS behavior can still be exercised against the real running app for the routes
 * that don't themselves call Cognito (GET /api/v1/user/me).
 */
import { randomUUID } from "node:crypto";
import { withDbClient } from "./dbClient";

export interface FixtureTenant {
  tenantId: string;
  roleId: string;
  cognitoSub: string;
}

const RIGHT_CODES_BY_ROLE: Record<string, string[]> = {
  procurement_owner: [
    "manage_contracts", "view_contracts", "manage_sourcing", "view_sourcing",
    "manage_vendors", "view_vendors", "manage_users", "view_dashboard",
    "use_ai_assistant", "view_audit_logs",
  ],
  procurement_manager: [
    "manage_contracts", "view_contracts", "manage_sourcing", "view_sourcing",
    "manage_vendors", "view_vendors", "view_dashboard", "use_ai_assistant",
  ],
  procurement_analyst: [
    "view_contracts", "view_sourcing", "view_vendors", "view_dashboard", "use_ai_assistant",
  ],
};

/** Creates a tenant + role (with §6.2 rights mapping) + user row directly in Postgres. */
export async function createFixtureTenantAndUser(options: {
  roleSlug: "procurement_owner" | "procurement_manager" | "procurement_analyst";
  tenantStatus?: "active" | "inactive";
  setupStatus?: "in_setup" | "handed_over";
}): Promise<FixtureTenant> {
  const tenantId = randomUUID();
  const roleId = randomUUID();
  const cognitoSub = randomUUID();
  const domain = `fixture-${Date.now()}-${Math.floor(Math.random() * 10000)}.test`;
  const tenantStatus = options.tenantStatus ?? "active";
  const setupStatus = options.setupStatus ?? "handed_over";
  const rightCodes = RIGHT_CODES_BY_ROLE[options.roleSlug] ?? [];

  await withDbClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO tenants (id, name, domain, status, setup_status, display_id, owner_name, owner_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tenantId, "Fixture Tenant", domain, tenantStatus, setupStatus, `FIX${Date.now() % 100000}`, "Fixture Owner", `owner-${tenantId}@fixture.test`],
      );
      await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
      await client.query(
        `INSERT INTO roles (id, tenant_id, name, slug, is_default) VALUES ($1, $2, $3, $4, true)`,
        [roleId, tenantId, options.roleSlug, options.roleSlug],
      );
      if (rightCodes.length > 0) {
        await client.query(
          `INSERT INTO role_rights (role_id, right_id)
           SELECT $1, id FROM rights WHERE code = ANY($2::text[])`,
          [roleId, rightCodes],
        );
      }
      await client.query(
        `INSERT INTO users (id, cognito_sub, tenant_id, role_id, name, email, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [randomUUID(), cognitoSub, tenantId, roleId, "Fixture User", `user-${tenantId}@fixture.test`],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });

  return { tenantId, roleId, cognitoSub };
}

export async function deleteFixtureTenant(tenantId: string): Promise<void> {
  await withDbClient(async (client) => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    await client.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM role_rights WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)`, [tenantId]);
    await client.query(`DELETE FROM roles WHERE tenant_id = $1`, [tenantId]);
    await client.query("COMMIT");
  });
  await withDbClient(async (client) => {
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });
}
