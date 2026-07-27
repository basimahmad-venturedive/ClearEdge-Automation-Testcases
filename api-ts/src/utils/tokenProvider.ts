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
import {
  cognitoRegion,
  cognitoAdminAppClientIdLive,
  devAdminUsername,
  devAdminPassword,
  cognitoTenantAppClientIdLive,
  devTenantUsername,
  devTenantPassword,
  devPmUsername,
  devPmPassword,
} from "../config/env";

let cachedAdminIdToken: string | null = null;
let cachedTenantIdToken: string | null = null;
let cachedManagerIdToken: string | null = null;

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

/**
 * Returns a real tenant-pool ID token for the configured DEV_TENANT_* user (a Procurement
 * Owner). Same USER_PASSWORD_AUTH flow as the admin token, against the tenant app client.
 * The backend's JwtAuthGuard reads custom:tenant_id / custom:role_id, which Cognito only
 * puts on the ID token — so we return the ID token (verified on dev 2026-07-20 → 200).
 * Throws on rejected credentials or a NEW_PASSWORD_REQUIRED challenge (temp password not set).
 */
export async function getTenantIdToken(): Promise<string> {
  if (cachedTenantIdToken) return cachedTenantIdToken;

  const endpoint = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  const response = await axios.post<InitiateAuthResult>(
    endpoint,
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoTenantAppClientIdLive(),
      AuthParameters: { USERNAME: devTenantUsername(), PASSWORD: devTenantPassword() },
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
      `Cognito InitiateAuth for the tenant user failed: HTTP ${response.status}${challenge} — ` +
        `${JSON.stringify(response.data)}. Check DEV_TENANT_USERNAME/DEV_TENANT_PASSWORD and ` +
        "COGNITO_TENANT_APP_CLIENT_ID in envs/.env.<env>.",
    );
  }

  cachedTenantIdToken = idToken;
  return idToken;
}

/**
 * Returns a real tenant-pool ID token for the configured DEV_PM_* user (a Procurement
 * Manager in the same tenant + app client as the PO). Used by the manager write-parity
 * case (TC-VDACCESS-012). Same USER_PASSWORD_AUTH flow as getTenantIdToken.
 */
export async function getManagerIdToken(): Promise<string> {
  if (cachedManagerIdToken) return cachedManagerIdToken;

  const endpoint = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  const response = await axios.post<InitiateAuthResult>(
    endpoint,
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoTenantAppClientIdLive(),
      AuthParameters: { USERNAME: devPmUsername(), PASSWORD: devPmPassword() },
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
      `Cognito InitiateAuth for the manager user failed: HTTP ${response.status}${challenge} — ` +
        `${JSON.stringify(response.data)}. Check DEV_PM_USERNAME/DEV_PM_PASSWORD and ` +
        "COGNITO_TENANT_APP_CLIENT_ID in envs/.env.<env>.",
    );
  }

  cachedManagerIdToken = idToken;
  return idToken;
}

/** Decodes the (unverified) claims of a JWT — used to read tenant_id/sub off a live token. */
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Test-only: drop the cached tokens (e.g. between suites that need a fresh mint). */
export function resetTokenCache(): void {
  cachedAdminIdToken = null;
  cachedTenantIdToken = null;
  cachedManagerIdToken = null;
}
