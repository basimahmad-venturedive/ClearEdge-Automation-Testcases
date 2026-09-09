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
 * Tokens are cached, but the cache is EXPIRY-AWARE. A Cognito id token lives 3600s, which used
 * to outlast a `vitest run` — it no longer does: the full QA suite took 3908s on 2026-09-07 and
 * the cached token expired mid-run, so a late `beforeAll` seed failed with
 * 401 ERR_AUTH_INVALID_TOKEN and skipped its whole describe block (the "Endpoint #14 - activate"
 * block, 8 cases). `isFresh` re-mints once the token is inside the safety margin.
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
  devAnalystUsername,
  devAnalystPassword,
  devTenant2Username,
  devTenant2Password,
} from "../config/env";

let cachedAdminIdToken: string | null = null;
let cachedTenantIdToken: string | null = null;
let cachedManagerIdToken: string | null = null;
let cachedAnalystIdToken: string | null = null;
let cachedTenant2IdToken: string | null = null;

/** Safety margin: re-mint while the token still has this long to live. */
const TOKEN_REFRESH_MARGIN_S = 300;

/**
 * True when `token` exists and is not within `TOKEN_REFRESH_MARGIN_S` of its `exp`.
 *
 * A run longer than the token's 3600s lifetime otherwise hands expired Bearers to whatever
 * suite happens to be scheduled last — a phantom 401 that moves around with test ordering.
 * An unparseable/`exp`-less token is treated as stale so the caller re-mints rather than
 * reusing something it cannot reason about.
 */
function isFresh(token: string | null): token is string {
  if (!token) return false;
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    if (typeof exp !== "number") return false;
    return exp - Math.floor(Date.now() / 1000) > TOKEN_REFRESH_MARGIN_S;
  } catch {
    return false;
  }
}

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
  if (isFresh(cachedAdminIdToken)) return cachedAdminIdToken;

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
  if (isFresh(cachedTenantIdToken)) return cachedTenantIdToken;

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
  if (isFresh(cachedManagerIdToken)) return cachedManagerIdToken;

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

/**
 * Returns a real tenant-pool ID token for the configured DEV_ANALYST_* user (a Procurement
 * Analyst — view_vendors only, no manage_vendors). Same USER_PASSWORD_AUTH flow / app client
 * as the PO. Used by the vendor Analyst view-only / 403 access cases (TC-VDACCESS-001…009).
 */
export async function getAnalystIdToken(): Promise<string> {
  if (isFresh(cachedAnalystIdToken)) return cachedAnalystIdToken;

  const endpoint = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  const response = await axios.post<InitiateAuthResult>(
    endpoint,
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoTenantAppClientIdLive(),
      AuthParameters: { USERNAME: devAnalystUsername(), PASSWORD: devAnalystPassword() },
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
      `Cognito InitiateAuth for the analyst user failed: HTTP ${response.status}${challenge} — ` +
        `${JSON.stringify(response.data)}. Check DEV_ANALYST_USERNAME/DEV_ANALYST_PASSWORD and ` +
        "COGNITO_TENANT_APP_CLIENT_ID in envs/.env.<env>.",
    );
  }

  cachedAnalystIdToken = idToken;
  return idToken;
}

/**
 * Returns a real tenant-pool ID token for the SECOND tenant (DEV_TENANT2_*).
 *
 * Same pool and app client as the PO, but a different `custom:tenant_id` - that is the whole
 * point: it is the only way to prove tenant isolation through the public API (one tenant's id
 * presented with another tenant's token must 404/403, never leak). Throws if DEV_TENANT2_* is
 * unset, so a caller that forgot to gate on hasSecondTenant() fails loudly instead of silently
 * re-testing the primary tenant against itself.
 */
export async function getTenant2IdToken(): Promise<string> {
  if (isFresh(cachedTenant2IdToken)) return cachedTenant2IdToken;
  if (!devTenant2Username() || !devTenant2Password()) {
    throw new Error(
      "getTenant2IdToken() called without DEV_TENANT2_USERNAME/DEV_TENANT2_PASSWORD - " +
        "gate the case on hasSecondTenant() or configure the second tenant in envs/.env.<env>.",
    );
  }

  const endpoint = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  const response = await axios.post<InitiateAuthResult>(
    endpoint,
    {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cognitoTenantAppClientIdLive(),
      AuthParameters: { USERNAME: devTenant2Username(), PASSWORD: devTenant2Password() },
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
      `Cognito InitiateAuth for the second-tenant user failed: HTTP ${response.status}${challenge} — ` +
        `${JSON.stringify(response.data)}. Check DEV_TENANT2_USERNAME/DEV_TENANT2_PASSWORD.`,
    );
  }

  cachedTenant2IdToken = idToken;
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
  cachedAnalystIdToken = null;
  cachedTenant2IdToken = null;
}
