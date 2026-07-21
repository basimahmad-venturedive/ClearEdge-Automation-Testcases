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
import { validAdminToken } from "./testTokens";

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
 * Removes a fixture tenant via the real API — `DELETE /admin/tenants/:id` — which also
 * deletes the tenant's Cognito owner (tenant.service.deleteTenant → cognitoAdminService.deleteUser),
 * so no Cognito users leak. Works on any environment (no DB access required). Mints its own
 * admin token so existing `teardownTenant(id)` call sites need no change. Best-effort: a failed
 * delete must not mask the test result.
 */
export async function teardownTenant(tenantId: string): Promise<void> {
  try {
    const token = await validAdminToken();
    await new AdminPortalClient().deleteTenant(tenantId, token);
  } catch {
    /* best-effort teardown */
  }
}
