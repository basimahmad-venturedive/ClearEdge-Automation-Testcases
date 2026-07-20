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
    // CEIQ-FEAT-004 (Company Settings) + clause config — seeded on the tenant's PO
    // role by the backend at creation, so the fixture must mirror them or the
    // company-settings tests get a false 403.
    "manage_company_settings", "manage_clause_configuration",
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
        // website_url is NOT NULL with no default (create-tenant domain→websiteUrl drift);
        // address is nullable but populated so User-Management management-home has org data.
        `INSERT INTO tenants (id, name, domain, status, setup_status, display_id, owner_name, owner_email, website_url, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [tenantId, "Fixture Tenant", domain, tenantStatus, setupStatus, `FIX${Date.now() % 100000}`, "Fixture Owner", `owner-${tenantId}@fixture.test`, `https://${domain}`, "1 Fixture Way, Test City"],
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
        // display_id is NOT NULL with no default (per-tenant USR-#### id); the app allocates
        // it from tenants.user_display_id_seq, but a direct fixture insert must supply one.
        `INSERT INTO users (id, cognito_sub, tenant_id, role_id, name, email, status, display_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
        [randomUUID(), cognitoSub, tenantId, roleId, "Fixture User", `user-${tenantId}@fixture.test`, `USR-${Date.now() % 1000000}`],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });

  return { tenantId, roleId, cognitoSub };
}

// ── User-Management scenario fixture (CEIQ-FEAT-003 read/list/guard cases) ─────
export interface ManagedUser {
  id: string;
  sub: string;
  name: string;
  email: string;
  roleSlug: "procurement_manager" | "procurement_analyst";
  displayId: string;
}

export interface ManagedTenant {
  tenantId: string;
  ownerRoleId: string;
  managerRoleId: string;
  analystRoleId: string;
  po: { sub: string; id: string; email: string; displayId: string };
  users: ManagedUser[];
}

// Named managed users chosen so the search/filter assertions are satisfiable:
// "Anna Khan" + "Zainab Anne" both contain "ann"; managers + analysts both present;
// every name contains "a" for the search+role AND-combine case.
const DEFAULT_MANAGED_USERS: Array<{ name: string; email: string; roleSlug: ManagedUser["roleSlug"] }> = [
  { name: "Anna Khan", email: "anna.khan@clearedge.test", roleSlug: "procurement_manager" },
  { name: "Omar Ali", email: "omar.ali@clearedge.test", roleSlug: "procurement_manager" },
  { name: "Zainab Anne", email: "zainab.anne@clearedge.test", roleSlug: "procurement_analyst" },
  { name: "Priya Nair", email: "priya.nair@clearedge.test", roleSlug: "procurement_analyst" },
];

/**
 * Creates a tenant with all three default roles (rights-mapped), a PO caller user, and
 * — when withManagedUsers — a set of named Manager/Analyst users with 4-digit USR-####
 * display ids (the list contract requires that format). Bypasses Cognito entirely, so it
 * only supports the READ/guard paths of User Management (create/edit/status call Cognito).
 */
export async function createManagedTenant(
  options: { tenantStatus?: "active" | "inactive"; withManagedUsers?: boolean } = {},
): Promise<ManagedTenant> {
  const tenantId = randomUUID();
  const roleIdBySlug: Record<string, string> = {
    procurement_owner: randomUUID(),
    procurement_manager: randomUUID(),
    procurement_analyst: randomUUID(),
  };
  const poSub = randomUUID();
  const poId = randomUUID();
  const poEmail = `owner-${tenantId}@fixture.test`;
  const domain = `fixture-${Date.now()}-${Math.floor(Math.random() * 10000)}.test`;
  const tenantStatus = options.tenantStatus ?? "active";
  const users: ManagedUser[] = [];

  await withDbClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO tenants (id, name, domain, status, setup_status, display_id, owner_name, owner_email, website_url, address)
         VALUES ($1, $2, $3, $4, 'handed_over', $5, $6, $7, $8, $9)`,
        [tenantId, "Fixture Tenant", domain, tenantStatus, `FIX${Date.now() % 100000}`, "Fixture Owner", poEmail, `https://${domain}`, "1 Fixture Way, Test City"],
      );
      await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
      const ROLE_DISPLAY_NAME: Record<string, string> = {
        procurement_owner: "Procurement Owner",
        procurement_manager: "Procurement Manager",
        procurement_analyst: "Procurement Analyst",
      };
      for (const slug of ["procurement_owner", "procurement_manager", "procurement_analyst"] as const) {
        await client.query(
          // name is the human-facing role label the API echoes back (user.role); the app's
          // own seed uses the display name, so mirror it (not the slug) or list/detail role
          // assertions get the raw slug.
          `INSERT INTO roles (id, tenant_id, name, slug, is_default) VALUES ($1, $2, $3, $4, true)`,
          [roleIdBySlug[slug], tenantId, ROLE_DISPLAY_NAME[slug], slug],
        );
        const rights = RIGHT_CODES_BY_ROLE[slug] ?? [];
        if (rights.length > 0) {
          await client.query(
            `INSERT INTO role_rights (role_id, right_id) SELECT $1, id FROM rights WHERE code = ANY($2::text[])`,
            [roleIdBySlug[slug], rights],
          );
        }
      }
      await client.query(
        `INSERT INTO users (id, cognito_sub, tenant_id, role_id, name, email, status, display_id)
         VALUES ($1, $2, $3, $4, 'Fixture Owner', $5, 'active', 'USR-0001')`,
        [poId, poSub, tenantId, roleIdBySlug.procurement_owner, poEmail],
      );
      if (options.withManagedUsers) {
        let seq = 2;
        for (const u of DEFAULT_MANAGED_USERS) {
          const id = randomUUID();
          const sub = randomUUID();
          const displayId = `USR-${String(seq).padStart(4, "0")}`;
          await client.query(
            `INSERT INTO users (id, cognito_sub, tenant_id, role_id, name, email, status, display_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
            [id, sub, tenantId, roleIdBySlug[u.roleSlug], u.name, u.email, displayId],
          );
          users.push({ id, sub, name: u.name, email: u.email, roleSlug: u.roleSlug, displayId });
          seq += 1;
        }
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  });

  return {
    tenantId,
    ownerRoleId: roleIdBySlug.procurement_owner!,
    managerRoleId: roleIdBySlug.procurement_manager!,
    analystRoleId: roleIdBySlug.procurement_analyst!,
    po: { sub: poSub, id: poId, email: poEmail, displayId: "USR-0001" },
    users,
  };
}

export async function deleteFixtureTenant(tenantId: string): Promise<void> {
  await withDbClient(async (client) => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    // company_settings.updated_by REFERENCES users(id) and RLS is FORCEd, so it must be
    // cleared (under app.current_tenant) BEFORE the users rows it points at.
    await client.query(`DELETE FROM company_settings WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM role_rights WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)`, [tenantId]);
    await client.query(`DELETE FROM roles WHERE tenant_id = $1`, [tenantId]);
    await client.query("COMMIT");
  });
  await withDbClient(async (client) => {
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  });
}
