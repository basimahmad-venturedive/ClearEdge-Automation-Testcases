/**
 * Live-environment token provider (dev/qa/prod).
 *
 * On live targets there is no local JWKS mock — the backend verifies against the real
 * Cognito JWKS. This mints a genuine admin token exactly the way the admin frontend does
 * (codebase/clearedge-admin/src/auth/authService.ts): Cognito InitiateAuth with the
 * USER_PASSWORD_AUTH flow against the admin app client, no client secret, no AWS signing.
 *
 * The backend's AdminJwtAuthGuard reads custom:* attributes (e.g. custom:admin), which
 * Cognito only puts on the ID token — never the access token — so we return the ID token
 * as the Bearer (verified against dev on 2026-07-14: ID token -> 200, access token -> 401).
 *
 * The token is cached for the process: a Cognito access/id token lives 3600s, well beyond
 * a single `vitest run`, so one InitiateAuth call serves the whole suite.
 */
import axios from "axios";
import { cognitoRegion, cognitoAdminAppClientIdLive, devAdminUsername, devAdminPassword } from "../config/env";

let cachedAdminIdToken: string | null = null;

interface InitiateAuthResult {
  AuthenticationResult?: { IdToken?: string; AccessToken?: string; RefreshToken?: string };
  ChallengeName?: string;
}

/**
 * Returns a real admin-pool ID token for the configured DEV_ADMIN_* user.
 * Throws (fail loud) if Cognito rejects the credentials or returns a challenge instead of
 * tokens — a NEW_PASSWORD_REQUIRED challenge means the user still has a temporary password
 * and must be finalised in the pool before automation can use it.
 */
export async function getAdminIdToken(): Promise<string> {
  if (cachedAdminIdToken) return cachedAdminIdToken;

  const endpoint = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  const response = await axios.post<InitiateAuthResult>(
    endpoint,
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoAdminAppClientIdLive(),
      AuthParameters: { USERNAME: devAdminUsername(), PASSWORD: devAdminPassword() },
    },
    {
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      validateStatus: () => true,
    },
  );

  const idToken = response.data?.AuthenticationResult?.IdToken;
  if (response.status !== 200 || !idToken) {
    const challenge = response.data?.ChallengeName ? ` (challenge: ${response.data.ChallengeName})` : "";
    throw new Error(
      `Cognito InitiateAuth for the admin user failed: HTTP ${response.status}${challenge} — ` +
        `${JSON.stringify(response.data)}. Check DEV_ADMIN_USERNAME/DEV_ADMIN_PASSWORD and ` +
        "COGNITO_ADMIN_APP_CLIENT_ID in envs/.env.<env>.",
    );
  }

  cachedAdminIdToken = idToken;
  return idToken;
}

/** Test-only: drop the cached token (e.g. between suites that need a fresh mint). */
export function resetTokenCache(): void {
  cachedAdminIdToken = null;
}
