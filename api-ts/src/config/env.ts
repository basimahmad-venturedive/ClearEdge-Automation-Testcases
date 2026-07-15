/**
 * Typed environment accessor for CEIQ-FOUND-001 (F1) API automation.
 *
 * No test, client, or fixture reads process.env directly — everything goes through
 * this module, per .claude/rules/secrets-and-env.rules.md. Missing base URLs throw
 * at call time (fail loud, no localhost fallback); missing secrets are handled by
 * the caller via test.skip() naming the variable.
 */

function getRequired(key: string): string {
  const val = process.env[key]?.trim();
  if (!val) {
    throw new Error(
      `${key} is not set. Populate it in automation/api-ts/envs/.env.<local|qa|prod> ` +
        "(copy from the matching .example file in that directory).",
    );
  }
  return val;
}

function getOptional(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

export const apiBaseUrl = (): string => getRequired("API_BASE_URL");
export const healthBaseUrl = (): string => getRequired("HEALTH_BASE_URL");

// Real Cognito pool IDs — only populated for qa/prod envs (envs/.env.qa, envs/.env.prod).
// Local uses automation/api-ts/local-env/localCognitoMock.ts instead (no real Cognito).
export const cognitoTenantUserPoolId = (): string => getRequired("COGNITO_TENANT_USER_POOL_ID");
export const cognitoTenantAppClientId = (): string => getRequired("COGNITO_TENANT_APP_CLIENT_ID");
export const cognitoAdminUserPoolId = (): string => getRequired("COGNITO_ADMIN_USER_POOL_ID");
export const cognitoAdminAppClientId = (): string => getRequired("COGNITO_ADMIN_APP_CLIENT_ID");
export const awsRegion = (): string => getRequired("AWS_REGION");

export const redisHost = (): string => getRequired("REDIS_HOST");
export const redisPort = (): number => Number(getOptional("REDIS_PORT", "6379"));

export const testDatabaseUrl = (): string => getRequired("TEST_DATABASE_URL");

export const maxResponseTimeS = (): number => Number(getOptional("MAX_RESPONSE_TIME_S", "3.0"));

export const useMock = (): boolean => getOptional("USE_MOCK", "0") === "1";

export const isEnvVarSet = (key: string): boolean => Boolean(process.env[key]?.trim());

// ---------------------------------------------------------------------------
// Environment selection + live-target auth (dev/qa/prod).
//
// TEST_ENV picks envs/.env.<env> (vitest.setup.ts). "local" runs against the
// Dockerized backend + JWKS mock; dev/qa/prod are "live" — real Cognito, no
// forged tokens, and (for now) no direct DB. Tests use isLiveEnv()/hasDbAccess()
// to skip what a live target can't support and to swap the token source.
// ---------------------------------------------------------------------------

/** Normalised TEST_ENV (defaults to "local"). */
export const testEnv = (): string => (process.env.TEST_ENV?.trim().toLowerCase() || "local");

/** True for real deployed targets (dev/qa/prod) where tokens must come from real Cognito. */
export const isLiveEnv = (): boolean => ["dev", "qa", "prod"].includes(testEnv());

/** True when a Postgres connection is configured — gates direct-DB assertions/fixtures. */
export const hasDbAccess = (): boolean => Boolean(process.env.TEST_DATABASE_URL?.trim());

// --- Live Cognito (admin pool) — used by tokenProvider to mint a real admin ID token. ---
export const cognitoRegion = (): string => getOptional("AWS_REGION", "us-east-1");
export const cognitoAdminAppClientIdLive = (): string => getRequired("COGNITO_ADMIN_APP_CLIENT_ID");
export const devAdminUsername = (): string => getRequired("DEV_ADMIN_USERNAME");
export const devAdminPassword = (): string => getRequired("DEV_ADMIN_PASSWORD");
