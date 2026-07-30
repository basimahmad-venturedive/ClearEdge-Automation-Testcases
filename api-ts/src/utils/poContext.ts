/**
 * Environment-aware Procurement-Owner context for tenant-scoped suites.
 *
 * Local: caller seeds a DB fixture + signs a mock token (see dbFixtures + localCognitoMock).
 * Live (dev/qa/prod): there is no DB and no forge-able key — the ONLY token the real backend
 * accepts is a genuine Cognito ID token, minted by logging in as the configured DEV_TENANT_*
 * Procurement Owner. This helper returns that live context so the env-agnostic read/validation
 * cases can run unchanged on a live target.
 */
import { getTenantIdToken, getManagerIdToken, getAnalystIdToken, decodeJwtClaims } from "./tokenProvider";

export interface OwnerContext {
  token: string;
  tenantId: string;
  cognitoSub: string;
  email: string;
}

/** Real PO context on a live target: log in as DEV_TENANT_* and read the claims off the token. */
export async function liveOwnerContext(): Promise<OwnerContext> {
  const token = await getTenantIdToken();
  const c = decodeJwtClaims(token);
  return {
    token,
    tenantId: String(c["custom:tenant_id"] ?? ""),
    cognitoSub: String(c.sub ?? ""),
    email: String(c.email ?? ""),
  };
}

/** Real Procurement-Manager context on a live target: log in as DEV_PM_* (same tenant as the PO). */
export async function liveManagerContext(): Promise<OwnerContext> {
  const token = await getManagerIdToken();
  const c = decodeJwtClaims(token);
  return {
    token,
    tenantId: String(c["custom:tenant_id"] ?? ""),
    cognitoSub: String(c.sub ?? ""),
    email: String(c.email ?? ""),
  };
}

/** Real Procurement-Analyst context (view_vendors only) on a live target: log in as DEV_ANALYST_*. */
export async function liveAnalystContext(): Promise<OwnerContext> {
  const token = await getAnalystIdToken();
  const c = decodeJwtClaims(token);
  return {
    token,
    tenantId: String(c["custom:tenant_id"] ?? ""),
    cognitoSub: String(c.sub ?? ""),
    email: String(c.email ?? ""),
  };
}
