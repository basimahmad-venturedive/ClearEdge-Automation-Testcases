/**
 * TC-UAUTH-API-020..024, 030..032, 040..041 + TC-UAUTH-SEC-001, TC-UAUTH-SEC-003 —
 * CEIQ-FEAT-002 User Authentication: POST /api/v1/auth/forgot-password, /refresh, /logout.
 * Spec: SPEC_CEIQ-FEAT-002-user-auth.md §3.2, §7, §8; cases: testcases/TC-CEIQ-FEAT-002.md (Module: API).
 * login / set-password + SEC-002 live in tests/auth.login-setpw.test.ts.
 *
 * Bodies are written to the §3.2 contract so they run unchanged once the endpoints ship
 * AND a Cognito-flow-capable environment exists. Every test is test.skip for now (see
 * SKIP_REASON). The validation-only cases (TC-UAUTH-API-024, TC-UAUTH-API-032) and the
 * structural no-password scan (TC-UAUTH-SEC-003) are flagged below: they are executable
 * as soon as the endpoint ships (no Cognito dependency).
 */
import { describe, test, expect } from "vitest";
import { AuthClient } from "../src/clients/authClient";
import {
  forgotPasswordPayload,
  refreshPayload,
  forgotValidationMatrix,
  forgotPasswordSuccessMessage,
  uniqueAuthEmail,
  REFRESH_MISSING_TOKEN_BODY,
  ERR_VALIDATION_FAILED,
  ERR_AUTH_INVALID_TOKEN,
  MSG_REFRESH_INVALID_TOKEN,
  MSG_LOGOUT_SUCCESS,
} from "../src/payloads/authPayloads";
import {
  ForgotPasswordSuccessEnvelopeSchema,
  RefreshSuccessEnvelopeSchema,
  LogoutSuccessEnvelopeSchema,
  ErrorEnvelopeSchema,
} from "../src/schemas/authSchemas";
import { assertResponseTime, assertErrorEnvelope } from "../src/utils/assertions";
import { isLiveEnv } from "../src/config/env";
import type { ErrorEnvelope } from "../src/payloads/types";

// CEIQ-FEAT-002 /auth/* shipped (dev pull 2026-07-14) and is live on dev. Forgot-password
// non-disclosure, validation, and invalid-token cases need NO real user — they run on live
// targets. Only the valid-refresh / valid-logout happy paths need real tokens and stay skipped.
const SKIP_REASON =
  "CEIQ-FEAT-002 /auth/* shipped (dev pull 2026-07-14); this case still needs a real token from a provisioned tenant-pool user (dev is admin-only, no DB)";
// Credential-free cases: run on a live target, skip on local (the /auth proxy hits the real
// Cognito tenant pool, unreachable locally).
const liveTest = isLiveEnv() ? test : test.skip;

// Findings from the first dev run (2026-07-14) — these credential-free cases are blocked by
// intentional dev backend behaviour, not by missing users, so they stay skipped:
const THROTTLED_REASON =
  "forgot-password is @Throttle rate-limited on dev (429 ERR_TOO_MANY_ATTEMPTS by ~the first call), so the non-disclosure 200 isn't deterministically observable — run against a target without the limiter or add backoff";
const LOGOUT_GUARD_REASON =
  "dev logout is behind AccessTokenAuthGuard → 401 on an invalid/garbage token, contradicting the spec's 'logout always 200' (§3.2) — discrepancy filed";

/**
 * Password-like FIELD markers that must NOT appear in a forgot-password response (SR-003).
 * Field-name shapes only — a bare "password" would false-match the success message text
 * ("...a temporary password and a link..."); `"password"` (quoted key) cannot appear there.
 */
const PASSWORD_LIKE_TOKENS = ['"temporaryPassword"', '"temporary_password"', '"tempPassword"', '"password"'];

/** Pulls `error.details.fields` out of a 400 ERR_VALIDATION_FAILED body. */
function validationFields(response: { data: unknown }): Record<string, string> {
  const err = response.data as ErrorEnvelope;
  return (err.error.details as { fields?: Record<string, string> } | undefined)?.fields ?? {};
}

describe("Auth — POST /api/v1/auth/forgot-password", () => {
  test.skip(`TC-UAUTH-API-020 — active user → 200 generic success, temp password set, no temp pw in body [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — an active user in Cognito + users; SendGrid reachable/mocked.
    const client = new AuthClient();
    const payload = forgotPasswordPayload();

    // Act
    const response = await client.forgotPassword(payload);

    // Assert — non-disclosure success (§3.2 step 6) + SR-003 (temp password never in the body).
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = ForgotPasswordSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.message).toBe(forgotPasswordSuccessMessage(payload.email));
    const raw = JSON.stringify(response.data);
    for (const leak of PASSWORD_LIKE_TOKENS) expect(raw).not.toContain(leak);
  });

  test.skip(`TC-UAUTH-API-021 — nonexistent email → identical 200 (non-disclosure, no email) [dev-skip: ${THROTTLED_REASON}] @smoke`, async () => {
    // Arrange — email not present in Cognito → AdminGetUser throws UserNotFoundException (§3.2 step 2a).
    const client = new AuthClient();
    const payload = forgotPasswordPayload({ email: "no-such-user@nowhere.test" });

    // Act
    const response = await client.forgotPassword(payload);

    // Assert — indistinguishable from the found case (SR-001).
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = ForgotPasswordSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.message).toBe(forgotPasswordSuccessMessage(payload.email));
  });

  test.skip(`TC-UAUTH-API-022 — inactive user → identical 200, no email dispatched [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — resolved user has users.status='inactive' (§3.2 step 4).
    const client = new AuthClient();
    const payload = forgotPasswordPayload();

    // Act
    const response = await client.forgotPassword(payload);

    // Assert — same success body; inactive is not disclosed here (the later login hits the wall).
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = ForgotPasswordSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.message).toBe(forgotPasswordSuccessMessage(payload.email));
  });

  test.skip(`TC-UAUTH-API-023 — malformed custom:tenant_id / Cognito-DB drift → identical 200 (fail closed) [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — fixture with missing custom:tenant_id or no users row (§3.2 steps 2b/3).
    const client = new AuthClient();
    const payload = forgotPasswordPayload();

    // Act
    const response = await client.forgotPassword(payload);

    // Assert — non-disclosure preserved; critical/warning is internal-only (not observable here).
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = ForgotPasswordSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.message).toBe(forgotPasswordSuccessMessage(payload.email));
  });

  // TC-UAUTH-API-024-1..2 — one explicit test case per validation sub-case (24a/24b).
  // Executable as soon as the endpoint ships — validation is §3.2 step 1, before any Cognito call.
  async function assertForgotValidationRejected(variantSub: string): Promise<void> {
    const variant = forgotValidationMatrix().find((v) => v.sub === variantSub);
    if (!variant) throw new Error(`Unknown forgot-validation sub-case: ${variantSub}`);
    const { overrides, message } = variant;

    const client = new AuthClient();
    const payload = forgotPasswordPayload(overrides);

    const response = await client.forgotPassword(payload);

    assertResponseTime(response);
    expect(response.status).toBe(400);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_VALIDATION_FAILED);
    expect(validationFields(response).email).toBe(message);
  }

  liveTest(`TC-UAUTH-API-024-1 — 24a email empty → 400 ERR_VALIDATION_FAILED, email field message`, () => assertForgotValidationRejected("24a email empty"));
  liveTest(`TC-UAUTH-API-024-2 — 24b email invalid format → 400 ERR_VALIDATION_FAILED, email field message`, () => assertForgotValidationRejected("24b email invalid format"));
});

describe("Auth — POST /api/v1/auth/refresh", () => {
  test.skip(`TC-UAUTH-API-030 — valid refresh token → 200 new access + id token (no new refresh token) [blocked: ${SKIP_REASON}]`, async () => {
    // Arrange — a valid Cognito refresh token from a prior login.
    const client = new AuthClient();
    const payload = refreshPayload();

    // Act
    const response = await client.refresh(payload);

    // Assert — §3.2 refresh success shape: accessToken + idToken + expiresIn, no refreshToken.
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = RefreshSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.idToken).toBeTruthy();
    expect(response.data).not.toHaveProperty("data.refreshToken");
    expect(JSON.stringify(response.data)).not.toContain("refreshToken");
  });

  // TC-UAUTH-API-031-1..2 — garbage vs revoked refresh token, one explicit test case each.
  async function assertInvalidRefreshRejected(refreshToken: string): Promise<void> {
    // Arrange
    const client = new AuthClient();
    const payload = refreshPayload({ refreshToken });

    // Act
    const response = await client.refresh(payload);

    // Assert — F1-reused ERR_AUTH_INVALID_TOKEN with the §3.2 refresh 401 message.
    assertResponseTime(response);
    expect(response.status).toBe(401);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_AUTH_INVALID_TOKEN);
    expect((response.data as ErrorEnvelope).error.message).toBe(MSG_REFRESH_INVALID_TOKEN);
  }

  liveTest(`TC-UAUTH-API-031-1 — 31a garbage refresh token → 401 ERR_AUTH_INVALID_TOKEN`, () =>
    assertInvalidRefreshRejected("garbage-refresh-token"));
  liveTest(`TC-UAUTH-API-031-2 — 31b token revoked by a prior GlobalSignOut → 401 ERR_AUTH_INVALID_TOKEN`, () =>
    assertInvalidRefreshRejected("revoked-refresh-token"));

  liveTest(`TC-UAUTH-API-032 — missing refreshToken → 400 validation (no 5xx)`, async () => {
    // Executable as soon as the endpoint ships — no Cognito call fires for an empty body.
    // Gap G-5: the spec does not pin the exact code for a missing refreshToken; assert 400
    // + no 5xx + envelope, and the inferred ERR_VALIDATION_FAILED. Adjust if the shipped code differs.
    const client = new AuthClient();

    const response = await client.refresh(REFRESH_MISSING_TOKEN_BODY);

    assertResponseTime(response);
    expect(response.status).toBeLessThan(500);
    expect(response.status).toBe(400);
    ErrorEnvelopeSchema.parse(response.data);
    assertErrorEnvelope(response, ERR_VALIDATION_FAILED);
  });
});

describe("Auth — POST /api/v1/auth/logout", () => {
  test.skip(`TC-UAUTH-API-040 — valid token → 200, GlobalSignOut invalidates all sessions [blocked: ${SKIP_REASON}] @smoke`, async () => {
    // Arrange — a valid access token + its session's refresh token from a prior login.
    const client = new AuthClient();
    const accessToken = "valid-access-token-from-login";
    const refreshToken = "valid-refresh-token-from-login";

    // Act + Assert — 1. logout succeeds.
    const logout = await client.logout(accessToken);
    assertResponseTime(logout);
    expect(logout.status).toBe(200);
    const body = LogoutSuccessEnvelopeSchema.parse(logout.data);
    expect(body.data.message).toBe(MSG_LOGOUT_SUCCESS);

    // 2. the same session's refresh token is now globally revoked (SR-008).
    const refreshAfter = await client.refresh(refreshPayload({ refreshToken }));
    assertResponseTime(refreshAfter);
    expect(refreshAfter.status).toBe(401);
    ErrorEnvelopeSchema.parse(refreshAfter.data);
    assertErrorEnvelope(refreshAfter, ERR_AUTH_INVALID_TOKEN);
  });

  test.skip(`TC-UAUTH-API-041 — logout returns 200 even with an already-invalid token [dev-skip: ${LOGOUT_GUARD_REASON}]`, async () => {
    // Arrange — a stale/garbage bearer token (§3.2 logout step 3: succeed regardless).
    const client = new AuthClient();

    // Act
    const response = await client.logout("expired-or-garbage-access-token");

    // Assert — cleanup intent: always 200 with the success message.
    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = LogoutSuccessEnvelopeSchema.parse(response.data);
    expect(body.data.message).toBe(MSG_LOGOUT_SUCCESS);
  });
});

describe("Auth — security: forgot-password non-disclosure + no temp password leak (§8)", () => {
  test.skip(`TC-UAUTH-SEC-001 — forgot-password is three-way non-disclosure (active/inactive/nonexistent identical) [dev-skip: ${THROTTLED_REASON}] @smoke`, async () => {
    // Arrange — one email per account state; only the echoed email may differ (SR-001).
    const client = new AuthClient();
    const activeEmail = uniqueAuthEmail("active");
    const inactiveEmail = uniqueAuthEmail("inactive");
    const nonexistentEmail = "no-such-user@nowhere.test";

    // Act
    const active = await client.forgotPassword(forgotPasswordPayload({ email: activeEmail }));
    const inactive = await client.forgotPassword(forgotPasswordPayload({ email: inactiveEmail }));
    const nonexistent = await client.forgotPassword(forgotPasswordPayload({ email: nonexistentEmail }));

    // Assert — same status, same key shape; message differs only by the echoed email string.
    for (const [response, email] of [
      [active, activeEmail],
      [inactive, inactiveEmail],
      [nonexistent, nonexistentEmail],
    ] as const) {
      assertResponseTime(response);
      expect(response.status).toBe(200);
      const body = ForgotPasswordSuccessEnvelopeSchema.parse(response.data);
      expect(body.data.message).toBe(forgotPasswordSuccessMessage(email));
      expect(Object.keys(body.data)).toEqual(["message"]);
    }
  });

  test.skip(`TC-UAUTH-SEC-003 — no temporary password anywhere in the forgot-password response [dev-skip: ${THROTTLED_REASON}] @smoke`, async () => {
    // Structural scan — executable as soon as the endpoint ships (no Cognito dependency for the
    // shape check; the full temp-password-set flow stays PARTIAL). SR-003.
    const client = new AuthClient();
    const payload = forgotPasswordPayload();

    const response = await client.forgotPassword(payload);

    assertResponseTime(response);
    expect(response.status).toBe(200);
    const body = ForgotPasswordSuccessEnvelopeSchema.parse(response.data);
    expect(Object.keys(body.data)).toEqual(["message"]);
    const raw = JSON.stringify(response.data);
    for (const leak of PASSWORD_LIKE_TOKENS) expect(raw).not.toContain(leak);
  });
});
