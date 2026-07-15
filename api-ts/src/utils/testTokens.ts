/**
 * Environment-aware "valid admin token" source.
 *
 * Local: a token signed by the local Cognito mock's keypair (the JWKS server the app
 *   trusts), so AdminJwtAuthGuard accepts it — same as calling signAdminToken directly.
 * Live (dev/qa/prod): a real admin-pool ID token minted via Cognito InitiateAuth
 *   (tokenProvider) — the only kind the real backend will accept.
 *
 * Tests that need "a valid platform-admin token" call this instead of hardcoding one
 * source, so the same spec runs on local and on a live target unchanged.
 */
import { randomUUID } from "crypto";
import { isLiveEnv } from "../config/env";
import { signAdminToken } from "../../local-env/localCognitoMock";
import { getAdminIdToken } from "./tokenProvider";

export async function validAdminToken(): Promise<string> {
  if (isLiveEnv()) return getAdminIdToken();
  // Local mock: the sub is arbitrary — the guard only checks signature/issuer/custom:admin.
  return signAdminToken({ sub: randomUUID() });
}
