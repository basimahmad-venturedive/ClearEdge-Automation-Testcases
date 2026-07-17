/**
 * TC-UAUTH-API-001..006, 010..013 + TC-UAUTH-SEC-002 —
 * CEIQ-FEAT-002 User Authentication: POST /api/v1/auth/login and /api/v1/auth/set-password.
 * Spec: SPEC_CEIQ-FEAT-002-user-auth.md §3.2, §7, §8; cases: testcases/TC-CEIQ-FEAT-002.md (Module: API).
 * forgot-password / refresh / logout + SEC-001/003 live in tests/auth.forgot-refresh-logout.test.ts.
 *
 * Bodies are written to the §3.2 contract so they run unchanged once the endpoints ship
 * AND a Cognito-flow-capable environment exists. Every test is test.skip for now (see
 * SKIP_REASON). The validation-only case (TC-UAUTH-API-004) is flagged below: it is
 * executable as soon as the endpoint ships (no Cognito dependency).
 */
import { describe, test, expect } from "vitest";
import { AuthClient } from "../src/clients/authClient";
import {
  loginPayload,
  setPasswordPayload,
  loginValidationMatrix,
  ERR_INVALID_CREDENTIALS,
  ERR_ACCOUNT_INACTIVE,
  ERR_TOO_MANY_ATTEMPTS,
  ERR_VALIDATION_FAILED,
  ERR_PASSWORD_POLICY_VIOLATION,
  ERR_SESSION_EXPIRED,
  MSG_INVALID_CREDENTIALS,
  MSG_ACCOUNT_INACTIVE,
  MSG_TOO_MANY_ATTEMPTS,
  MSG_SESSION_EXPIRED,
  MSG_SET_PASSWORD_SUCCESS,
} from "../src/payloads/authPayloads";
import {
  LoginSuccessEnvelopeSchema,
  SetPasswordSuccessEnvelopeSchema,
  ErrorEnvelopeSchema,
} from "../src/schemas/authSchemas";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import { isLiveEnv } from "../src/config/env";
import type { ErrorEnvelope } from "../src/payloads/types";

// CEIQ-FEAT-002 /auth/* shipped (dev pull 2026-07-14) and is live on dev. Validation,
// invalid-credential, and set-password-session cases need NO real user — they run on live
// targets. The remaining cases still need a provisioned tenant-pool user or a specific
// Cognito fixture (dev has admin-only creds, no DB) and stay skipped.
const SKIP_REASON =
  "CEIQ-FEAT-002 /auth/* shipped (dev pull 2026-07-14); this case still needs a provisioned tenant-pool user or a specific Cognito fixture (dev is admin-only, no DB)";
// Credential-free cases: run on a live target (dev/qa/prod), skip on local (the Dockerized
// backend's /auth/login proxies the real Cognito tenant pool, which isn't reachable locally).
const liveTest = isLiveEnv() ? test : test.skip;

/** Error codes this spec is allowed to surface (§7) — used by SEC-002 leak check. */
const MAPPED_ERROR_CODES = [
  ERR_INVALID_CREDENTIALS,
  ERR_TOO_MANY_ATTEMPTS,
  ERR_ACCOUNT_INACTIVE,
  ERR_PASSWORD_POLICY_VIOLATION,
  ERR_SESSION_EXPIRED,
  ERR_VALIDATION_FAILED,
];

/** Pulls `error.details.fields` out of a 400 ERR_VALIDATION_FAILED body. */
function validationFields(response: { data: unknown }): Record<string, string> {
  const err = response.data as ErrorEnvelope;
  return (err.error.details as { fields?: Record<string, string> } | undefined)?.fields ?? {};
}

describe("Auth — POST /api/v1/auth/login", () => {
  test.skip(`TC-UAUTH-API-001 — valid credentials → 200 tokens, challengeName null [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — an active tenant user with a real (already-set) password.
    const client = new AuthClient();
    const payload = loginPayload();

    // Act
    const response = await client.login(payload);

    // Assert — status + schema + spec-pinned normal-login invariants
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = LoginSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.challengeName).toBeNull();
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.refreshToken).toBeTruthy();
    expect(body.data.idToken).toBeTruthy();
    expect(typeof body.data.expiresIn).toBe("number");
  });

  // TC-UAUTH-API-002-1..3 — invalid-credentials and lockout mapping, one explicit test case
  // per sub-case (2a/2b/2c). 2a and 2b assert the IDENTICAL generic message (non-enumeration, SR-002).
  async function assertInvalidCredentialsMapped(
    overrides: Parameters<typeof loginPayload>[0],
    expectedStatus: number,
    expectedCode: string,
    expectedMessage: string,
  ): Promise<void> {
    // Arrange
    const client = new AuthClient();
    const payload = loginPayload(overrides);

    // Act
    const response = await client.login(payload);

    // Assert
    assertResponseTime(response);
    expect(response.status).toBe(expectedStatus);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, expectedCode);
    expect((response.data as ErrorEnvelope).error.message).toBe(expectedMessage);
  }

  liveTest(`TC-UAUTH-API-002-1 — 2a wrong password (existing user) → mapped error, no enumeration @smoke`, () =>
    assertInvalidCredentialsMapped({ password: "WrongP@ss9" }, 401, ERR_INVALID_CREDENTIALS, MSG_INVALID_CREDENTIALS));

  liveTest(`TC-UAUTH-API-002-2 — 2b nonexistent user → mapped error, no enumeration @smoke`, () =>
    assertInvalidCredentialsMapped({}, 401, ERR_INVALID_CREDENTIALS, MSG_INVALID_CREDENTIALS));

  // 2c (lockout/429) is excluded from automated runs — it needs deliberate repeated failures and
  // would risk tripping Cognito throttling for the rest of the suite.
  test.skip(`TC-UAUTH-API-002-3 — 2c lockout (repeated failures → Cognito TooManyRequests) → 429 ERR_TOO_MANY_ATTEMPTS [blocked: deliberate repeated failures would trip Cognito throttling for the rest of the suite]`, () =>
    assertInvalidCredentialsMapped({}, 429, ERR_TOO_MANY_ATTEMPTS, MSG_TOO_MANY_ATTEMPTS));

  test.skip(`TC-UAUTH-API-003 — correct-credential inactive user → 403 ERR_ACCOUNT_INACTIVE [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — users.status='inactive' but Cognito still authenticates (§3.2 step 5e race).
    const client = new AuthClient();
    const payload = loginPayload();

    // Act
    const response = await client.login(payload);

    // Assert — bounded disclosure (SR-002): the inactive message only fires on a correct password.
    assertResponseTime(response);
    expect(response.status).toBe(403);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_ACCOUNT_INACTIVE);
    expect((response.data as ErrorEnvelope).error.message).toBe(MSG_ACCOUNT_INACTIVE);
  });

  // TC-UAUTH-API-004-1..3 — one explicit test case per §3.2 validation sub-case (4a/4b/4c).
  // Executable as soon as the endpoint ships — validation happens at §3.2 step 1,
  // BEFORE any Cognito call, so these cases have no Cognito dependency.
  async function assertLoginValidationRejected(variantSub: string): Promise<void> {
    const variant = loginValidationMatrix().find((v) => v.sub === variantSub);
    if (!variant) throw new Error(`Unknown login-validation sub-case: ${variantSub}`);
    const { overrides, field, message } = variant;

    const client = new AuthClient();
    const payload = loginPayload(overrides);

    const response = await client.login(payload);

    assertResponseTime(response);
    expect(response.status).toBe(400);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_VALIDATION_FAILED);
    expect(validationFields(response)[field]).toBe(message);
  }

  liveTest(`TC-UAUTH-API-004-1 — 4a email empty → 400 ERR_VALIDATION_FAILED with exact §3.2 per-field message`, () => assertLoginValidationRejected("4a email empty"));
  liveTest(`TC-UAUTH-API-004-2 — 4b email invalid format → 400 ERR_VALIDATION_FAILED with exact §3.2 per-field message`, () => assertLoginValidationRejected("4b email invalid format"));
  liveTest(`TC-UAUTH-API-004-3 — 4c password empty → 400 ERR_VALIDATION_FAILED with exact §3.2 per-field message`, () => assertLoginValidationRejected("4c password empty"));

  test.skip(`TC-UAUTH-API-005 — missing/malformed custom:tenant_id → 401 ERR_INVALID_CREDENTIALS (fail closed) [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — Cognito user with a correct password but missing/blank/non-UUID custom:tenant_id (§3.2 step 5c).
    const client = new AuthClient();
    const payload = loginPayload();

    // Act
    const response = await client.login(payload);

    // Assert — integrity issue is never leaked to the client; no tokens issued.
    assertResponseTime(response);
    expect(response.status).toBe(401);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_INVALID_CREDENTIALS);
    expect((response.data as ErrorEnvelope).error.message).toBe(MSG_INVALID_CREDENTIALS);
  });

  test.skip(`TC-UAUTH-API-006 — Cognito/DB drift (no users row for sub) → 401 ERR_INVALID_CREDENTIALS [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — Cognito authenticates but no users.cognito_sub row exists in the resolved tenant (§3.2 step 5e).
    const client = new AuthClient();
    const payload = loginPayload();

    // Act
    const response = await client.login(payload);

    // Assert — non-disclosure of drift.
    assertResponseTime(response);
    expect(response.status).toBe(401);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_INVALID_CREDENTIALS);
  });
});

describe("Auth — POST /api/v1/auth/set-password", () => {
  test.skip(`TC-UAUTH-API-010 — valid challenge completion → 200 confirmation, no tokens returned [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — a valid `session` from a prior /login NEW_PASSWORD_REQUIRED challenge.
    const client = new AuthClient();
    const payload = setPasswordPayload();

    // Act
    const response = await client.setPassword(payload);

    // Assert — success message + SR-006 (Cognito tokens discarded server-side, never in the body).
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = SetPasswordSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.message).toBe(MSG_SET_PASSWORD_SUCCESS);
    const raw = JSON.stringify(response.data);
    for (const tokenField of ["accessToken", "refreshToken", "idToken"]) {
      expect(raw).not.toContain(tokenField);
    }
  });

  test.skip(`TC-UAUTH-API-011 — password-policy violation → 400 ERR_PASSWORD_POLICY_VIOLATION with Cognito message [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — valid session, a new password that fails the pool policy (OQ-1 rules TBD).
    const client = new AuthClient();
    const payload = setPasswordPayload({ newPassword: "weak" });

    // Act
    const response = await client.setPassword(payload);

    // Assert — Cognito's policy text is passed through in details.cognitoMessage.
    assertResponseTime(response);
    expect(response.status).toBe(400);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_PASSWORD_POLICY_VIOLATION);
    expect((response.data as ErrorEnvelope).error.details).toHaveProperty("cognitoMessage");
  });

  // TC-UAUTH-API-012-1..2 — expired vs garbage challenge session, one explicit test case each.
  async function assertSessionExpired(session: string): Promise<void> {
    // Arrange
    const client = new AuthClient();
    const payload = setPasswordPayload({ session });

    // Act
    const response = await client.setPassword(payload);

    // Assert
    assertResponseTime(response);
    expect(response.status).toBe(401);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_SESSION_EXPIRED);
    expect((response.data as ErrorEnvelope).error.message).toBe(MSG_SESSION_EXPIRED);
  }

  liveTest(`TC-UAUTH-API-012-1 — 12a expired challenge session (past Cognito ~3-min window) → 401 ERR_SESSION_EXPIRED`, () =>
    assertSessionExpired("expired-challenge-session-token"));
  liveTest(`TC-UAUTH-API-012-2 — 12b garbage session string → 401 ERR_SESSION_EXPIRED`, () =>
    assertSessionExpired("!!!not-a-real-session!!!"));

  test.skip(`TC-UAUTH-API-013 — old temp password rejected after successful set; new password works (single-use) [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — chains after TC-UAUTH-API-010: password has been set, holding the retired temp password.
    const client = new AuthClient();
    const tempPasswordLogin = loginPayload({ password: "OldTempP@ss1" });
    const newPasswordLogin = loginPayload({ email: tempPasswordLogin.email, password: "MyNewSecure@Pass1" });

    // Act + Assert — 1. old temp password is retired.
    const retired = await client.login(tempPasswordLogin);
    assertResponseTime(retired);
    expect(retired.status).toBe(401);
    ErrorEnvelopeSchema.parse(retired.data);
    assertErrorEnvelope(retired, ERR_INVALID_CREDENTIALS);

    // 2. the newly-set password logs in normally.
    const success = await client.login(newPasswordLogin);
    assertResponseTime(success);
    expect(success.status).toBe(200);
    const body = LoginSuccessEnvelopeSchema.parse(success.data);
    expect(body.data.challengeName).toBeNull();
    expect(body.data.accessToken).toBeTruthy();
  });
});

describe("Auth — security: no raw Cognito errors leak (§9, SR-002/SR-007)", () => {
  liveTest(`TC-UAUTH-SEC-002 — every error body is a mapped spec code, no raw Cognito detail`, async () => {
    // Arrange — drive login into a Cognito exception path (wrong credentials → NotAuthorizedException).
    const client = new AuthClient();
    const payload = loginPayload({ password: "WrongP@ss9" });

    // Act
    const response = await client.login(payload);

    // Assert — mapped code only; no Cognito exception name / stack surfaces to the client.
    assertResponseTime(response);
    ErrorEnvelopeSchema.parse(response.data);
    const err = response.data as ErrorEnvelope;
    expect(MAPPED_ERROR_CODES).toContain(err.error.code);
    const raw = JSON.stringify(response.data);
    for (const leak of ["Exception", "Cognito", "stack", "InitiateAuth"]) {
      expect(raw).not.toContain(leak);
    }
  });
});
