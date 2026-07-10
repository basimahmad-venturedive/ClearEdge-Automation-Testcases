/**
 * Shared arrange/teardown helpers for the CEIQ-FEAT-001 Admin Portal suites, so the
 * "create a Setup tenant" / "create a Handed-Over tenant" multi-step setup is not
 * copy-pasted across test files (automation-architecture.rules §1).
 *
 * All helpers go through the real API (AdminPortalClient) so fixtures exercise the
 * same contract the tests assert; teardown goes straight to the DB via dbClient.
 */
import type { AxiosResponse } from "axios";
import { AdminPortalClient } from "../clients/adminPortalClient";
import {
  adminTenantCreatePayload,
  type AdminTenantCreatePayload,
} from "../payloads/adminPortalPayloads";
import { TenantDetailEnvelopeSchema, type AdminTenantDetail } from "../schemas/adminPortalSchemas";
import { withDbClient } from "./dbClient";

export interface CreatedTenantFixture {
  payload: AdminTenantCreatePayload;
  tenant: AdminTenantDetail;
  response: AxiosResponse;
}

/** Creates a fresh tenant via POST /admin/tenants and returns the parsed 201 body (in_setup, inactive). */
export async function createSetupTenant(
  client: AdminPortalClient,
  adminToken: string,
  overrides: Partial<AdminTenantCreatePayload> = {},
): Promise<CreatedTenantFixture> {
  const payload = adminTenantCreatePayload(overrides);
  const response = await client.createTenant(payload, adminToken);
  if (response.status !== 201) {
    throw new Error(`Fixture tenant creation failed: HTTP ${response.status} — ${JSON.stringify(response.data)}`);
  }
  const body = TenantDetailEnvelopeSchema.parse(response.data);
  return { payload, tenant: body.data, response };
}

/** Creates a tenant and immediately hands it over (active / handed_over / setupPassword wiped). */
export async function createHandedOverTenant(
  client: AdminPortalClient,
  adminToken: string,
  overrides: Partial<AdminTenantCreatePayload> = {},
): Promise<CreatedTenantFixture & { setupPasswordBeforeHandover: string | null }> {
  const created = await createSetupTenant(client, adminToken, overrides);
  const handover = await client.triggerHandover(created.tenant.id, adminToken);
  if (handover.status !== 200) {
    throw new Error(`Fixture handover failed: HTTP ${handover.status} — ${JSON.stringify(handover.data)}`);
  }
  const body = TenantDetailEnvelopeSchema.parse(handover.data);
  return {
    payload: created.payload,
    tenant: body.data,
    response: handover,
    setupPasswordBeforeHandover: created.tenant.setupPassword ?? null,
  };
}

/**
 * Removes a fixture tenant and its child rows directly in the DB (test-namespace teardown).
 * Runs as the privileged TEST_DATABASE_URL role — RLS tenant context is not required for
 * control-plane tables; if the local schema adds it, wrap in SET LOCAL app.current_tenant.
 * Cognito user cleanup is a TODO until a Cognito admin helper exists in this kit.
 */
export async function teardownTenant(tenantId: string): Promise<void> {
  await withDbClient(async (db) => {
    await db.query("DELETE FROM role_rights WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)", [tenantId]);
    await db.query("DELETE FROM users WHERE tenant_id = $1", [tenantId]);
    await db.query("DELETE FROM roles WHERE tenant_id = $1", [tenantId]);
    // Actual schema (migration 20260706000001) is table_name/record_id — NOT entity/entity_id.
    // Using the wrong column names here threw "column does not exist" and broke teardown.
    await db.query("DELETE FROM platform_audit_logs WHERE table_name = 'tenants' AND record_id = $1", [tenantId]);
    await db.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
  });
}
