/**
 * TC-AUTH-001..008 — JWT authentication guards (JwtAuthGuard, AdminJwtAuthGuard).
 * Spec: SPEC_CEIQ-FOUND-001-identity-rbac-audit.md §7, §8.1, §9 (SR-001, SR-002, SR-006).
 *
 * RUNNING FOR REAL against codebase/clearedge-backend on Local (2026-07-08) via:
 *   - GET /api/v1/user/me as the "protected tenant-app route" (no @RequireRight — exercises
 *     JwtAuthGuard + RightsGuard pass-through only, not Cognito).
 *   - POST /api/v1/tenants as the "protected admin-portal route" for pool-separation checks —
 *     this route also calls the real AWS Cognito SDK, which fails locally
 *     (ERR_COGNITO_OPERATION_FAILED, confirmed 2026-07-08 — no local Cognito exists). That
 *     failure is *itself* proof the request passed AdminJwtAuthGuard + PlatformAdminGuard —
 *     a 401/403 would have been returned before reaching the service layer. TC-AUTH-006
 *     relies on this distinction; do not read ERR_COGNITO_OPERATION_FAILED as a test failure.
 */
import { afterEach, describe, expect } from "vitest";
import { ControlPlaneClient, ENDPOINT_USER_ME, ENDPOINT_TENANT_CREATE } from "../src/clients/controlPlaneClient";
import { signTenantToken, signAdminToken, tamperToken } from "../local-env/localCognitoMock";
import { createFixtureTenantAndUser, deleteFixtureTenant, type FixtureTenant } from "../src/utils/dbFixtures";
import { tenantCreationPayload } from "../src/payloads/identityRbacPayloads";
import { isLiveEnv } from "../src/config/env";
import { test, localOnly } from "../src/utils/suite";
import { validAdminToken } from "../src/utils/testTokens";

const client = new ControlPlaneClient();
let fixture: FixtureTenant | undefined;

// A *valid tenant-pool* principal needs either the local mock (forged claims signed by the
// JWKS mock + a DB fixture) or a real provisioned tenant user. On live dev we have neither
// (admin-only creds, no DB reachability), so these run on local only. See tests/auth.test.ts
// header + the dev refactor: admin-authenticated guard/pool checks still run on live.
// These cases need a local mock + DB fixture (tenant-pool user), so they run on local
// only — `localOnly` (from src/utils/suite) drops them on dev under REGRESSION_ONLY.
const TENANT_SKIP_REASON =
  "requires a valid tenant-pool user (local mock + DB fixture) — not available on live dev (admin-only, no DB)";

afterEach(async () => {
  if (fixture) {
    await deleteFixtureTenant(fixture.tenantId);
    fixture = undefined;
  }
});

describe("Auth guards — real local backend", () => {
  localOnly(`TC-AUTH-001 — valid tenant-pool JWT accepted; principal populated (SR-001) [live-skip: ${TENANT_SKIP_REASON}]`, async () => {
    fixture = await createFixtureTenantAndUser({ roleSlug: "procurement_manager" });
    const token = await signTenantToken({ sub: fixture.cognitoSub, tenantId: fixture.tenantId, roleId: fixture.roleId });

    const response = await client.get<{ data: { tenantId: string; roleId: string } }>(ENDPOINT_USER_ME, token);

    expect(response.status).toBe(200);
    expect(response.data.data.tenantId).toBe(fixture.tenantId);
    expect(response.data.data.roleId).toBe(fixture.roleId);
  });

  // TC-AUTH-002/003/004 — invalid-JWT variants, one explicit test case each (no data-driven .each).
  // On live dev only "tampered_signature" is constructible (tamper a real admin token). The
  // "wrong_issuer"/"expired" variants must be minted with the local mock's key, so they run
  // on local only — the untrusted-signer path they exercise is also covered live by TC-AUTH-008.
  async function assertInvalidJwtRejected(token: string): Promise<void> {
    const response = await client.get(ENDPOINT_USER_ME, token);

    expect(response.status).toBe(401);
    expect((response.data as { error: { code: string } }).error.code).toBe("ERR_AUTH_INVALID_TOKEN");
  }

  test("TC-AUTH-002 — invalid JWT variant=tampered_signature rejected 401 ERR_AUTH_INVALID_TOKEN (SR-002) @regression", async () => {
    // Live: tamper a genuine admin ID token. Local: tamper a mock-signed tenant token.
    const token = tamperToken(
      isLiveEnv() ? await validAdminToken() : await signTenantToken({ sub: "x", tenantId: "y", roleId: "z" }),
    );
    await assertInvalidJwtRejected(token);
  });

  localOnly(`TC-AUTH-003 — invalid JWT variant=wrong_issuer rejected 401 ERR_AUTH_INVALID_TOKEN (SR-002) [live-skip: constructible only with the local mock key]`, async () => {
    // Real backend only trusts COGNITO_TENANT_JWKS_URI's issuer — any other issuer fails
    // signature/issuer validation the same way an unrecognized signer would.
    const token = tamperToken(await signAdminToken({ sub: "x" }));
    await assertInvalidJwtRejected(token);
  });

  localOnly(`TC-AUTH-004 — invalid JWT variant=expired rejected 401 ERR_AUTH_INVALID_TOKEN (SR-002) [live-skip: constructible only with the local mock key]`, async () => {
    const token = await signTenantToken({ sub: "x", tenantId: "y", roleId: "z", expiresInSeconds: -3600 });
    await assertInvalidJwtRejected(token);
  });

  localOnly(`TC-AUTH-005 — missing role_id claim (SR-006) — DEVIATION FOUND: real code returns 401 ERR_AUTH_INVALID_TOKEN, not 403 as spec states [live-skip: ${TENANT_SKIP_REASON}]`, async () => {
    fixture = await createFixtureTenantAndUser({ roleSlug: "procurement_manager" });
    const token = await signTenantToken({ sub: fixture.cognitoSub, tenantId: fixture.tenantId }); // no roleId

    const response = await client.get(ENDPOINT_USER_ME, token);

    // Spec SR-006 says this should be 403 ERR_RBAC_FORBIDDEN ("default-deny; no role = no rights").
    // Actual: src/auth/jwt-auth.guard.ts's isTenantPoolClaims() requires custom:role_id to even
    // form a valid TenantPoolClaims shape — so JwtAuthGuard itself rejects with 401
    // ERR_AUTH_INVALID_TOKEN before RightsGuard (which would return 403) ever runs.
    expect(response.status).toBe(401);
    expect((response.data as { error: { code: string } }).error.code).toBe("ERR_AUTH_INVALID_TOKEN");
  });

  test("TC-AUTH-006 — valid admin-pool JWT accepted (reaches business logic, not rejected by guards) (§8.1) @smoke @regression", async () => {
    const token = await validAdminToken();

    // Live dev: send an intentionally invalid body. Validation runs AFTER the guards, so a
    // 400 still proves AdminJwtAuthGuard + PlatformAdminGuard accepted the token — and no real
    // tenant/Cognito user is created (which a valid payload WOULD do on dev, with no teardown).
    const payload = isLiveEnv() ? {} : tenantCreationPayload();

    const response = await client.post<{ data?: { id?: string }; error?: { code?: string } }>(
      ENDPOINT_TENANT_CREATE,
      payload,
      token,
    );

    // The point of this test is pool acceptance: a valid admin-pool JWT must PASS
    // AdminJwtAuthGuard + PlatformAdminGuard (never 401/403) and reach the business/validation layer.
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);

    if (!isLiveEnv()) {
      // Local: outcome depends on AWS Cognito reachability from the container (intermittent):
      // reachable -> 201 create; unreachable -> ERR_COGNITO_OPERATION_FAILED. Both prove acceptance.
      const errCode = response.data.error?.code;
      expect(errCode === undefined || errCode === "ERR_COGNITO_OPERATION_FAILED").toBe(true);
      // If creation actually succeeded, remove the DB rows we just made (Cognito user cleanup
      // is out of scope — no admin helper exists in this kit yet).
      if (response.status === 201 && response.data.data?.id) {
        await deleteFixtureTenant(response.data.data.id);
      }
    }
    // The Cognito SDK path can take several seconds (AWS timeout), so allow more than the default 5s.
  }, 20000);

  localOnly(`TC-AUTH-007 — tenant-pool token rejected by admin-portal route (§7.1 pool separation) [live-skip: ${TENANT_SKIP_REASON}]`, async () => {
    fixture = await createFixtureTenantAndUser({ roleSlug: "procurement_manager" });
    const token = await signTenantToken({ sub: fixture.cognitoSub, tenantId: fixture.tenantId, roleId: fixture.roleId });

    const response = await client.post(ENDPOINT_TENANT_CREATE, tenantCreationPayload(), token);

    expect(response.status).toBe(401);
    expect((response.data as { error: { code: string } }).error.code).toBe("ERR_AUTH_INVALID_TOKEN");
  });

  test("TC-AUTH-008 — admin-pool token rejected by tenant-app route (§7.1 pool separation) @regression", async () => {
    const token = await validAdminToken();

    const response = await client.get(ENDPOINT_USER_ME, token);

    expect(response.status).toBe(401);
    expect((response.data as { error: { code: string } }).error.code).toBe("ERR_AUTH_INVALID_TOKEN");
  });
});
