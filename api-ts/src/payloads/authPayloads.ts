/**
 * Payload factories and spec-pinned constants for CEIQ-FEAT-002 (User Authentication).
 *
 * Field names/shapes taken verbatim from SPEC_CEIQ-FEAT-002-user-auth.md §3.2 request
 * tables and JSON examples, and the error codes/messages from §7. Emails are unique per
 * run (timestamp + random suffix) so repeated/parallel runs never collide on Cognito
 * usernames once a Cognito-flow environment exists.
 */
import { faker } from "@faker-js/faker";

// ---------------------------------------------------------------------------
// Request types (spec §3.2)
// ---------------------------------------------------------------------------

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SetPasswordPayload {
  session: string;
  email: string;
  newPassword: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface RefreshPayload {
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Spec-pinned error codes (§7) — auth-owned + F1-reused
// ---------------------------------------------------------------------------

export const ERR_INVALID_CREDENTIALS = "ERR_INVALID_CREDENTIALS"; // 401
export const ERR_ACCOUNT_INACTIVE = "ERR_ACCOUNT_INACTIVE"; // 403
export const ERR_TOO_MANY_ATTEMPTS = "ERR_TOO_MANY_ATTEMPTS"; // 429
export const ERR_PASSWORD_POLICY_VIOLATION = "ERR_PASSWORD_POLICY_VIOLATION"; // 400
export const ERR_SESSION_EXPIRED = "ERR_SESSION_EXPIRED"; // 401
export const ERR_VALIDATION_FAILED = "ERR_VALIDATION_FAILED"; // 400
export const ERR_AUTH_INVALID_TOKEN = "ERR_AUTH_INVALID_TOKEN"; // 401 (F1-reused, refresh)

// ---------------------------------------------------------------------------
// Spec-pinned messages (§3.2 examples, §5.2/§5.4 handling tables)
// ---------------------------------------------------------------------------

export const MSG_INVALID_CREDENTIALS = "Invalid email or password. Please try again.";
export const MSG_ACCOUNT_INACTIVE = "Your account has been deactivated. Contact your Procurement Owner for access.";
export const MSG_TOO_MANY_ATTEMPTS = "Too many failed attempts. Please try again later.";
export const MSG_SESSION_EXPIRED = "Your session has expired. Please log in again.";
export const MSG_REFRESH_INVALID_TOKEN = "Session expired. Please log in again."; // §3.2 refresh 401 body
export const MSG_SET_PASSWORD_SUCCESS = "Your password has been set. Please log in.";
export const MSG_LOGOUT_SUCCESS = "Logged out successfully.";

/** §3.2 forgot-password success — the email is echoed back into the message. */
export function forgotPasswordSuccessMessage(email: string): string {
  return `We've sent an email to ${email} with a temporary password and a link to log in.`;
}

/** Exact per-field validation messages (§3.2 login/forgot request tables). */
export const FIELD_MESSAGES = {
  emailInvalid: "Please enter a valid email address.",
  passwordRequired: "Password is required.",
} as const;

// ---------------------------------------------------------------------------
// Unique-per-run helpers + factories
// ---------------------------------------------------------------------------

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${faker.string.alphanumeric(6).toLowerCase()}`;
}

/** Unique-per-run email so Cognito usernames never collide across runs. */
export function uniqueAuthEmail(local = "user"): string {
  return `${local}.${uniqueSuffix()}@example.test`;
}

export function loginPayload(overrides: Partial<LoginPayload> = {}): LoginPayload {
  return {
    email: uniqueAuthEmail("login"),
    password: "SecureP@ss1",
    ...overrides,
  };
}

export function setPasswordPayload(overrides: Partial<SetPasswordPayload> = {}): SetPasswordPayload {
  return {
    session: `challenge-session-${uniqueSuffix()}`,
    email: uniqueAuthEmail("setpw"),
    newPassword: "MyNewSecure@Pass1",
    ...overrides,
  };
}

export function forgotPasswordPayload(overrides: Partial<ForgotPasswordPayload> = {}): ForgotPasswordPayload {
  return {
    email: uniqueAuthEmail("forgot"),
    ...overrides,
  };
}

export function refreshPayload(overrides: Partial<RefreshPayload> = {}): RefreshPayload {
  return {
    refreshToken: `refresh-token-${uniqueSuffix()}`,
    ...overrides,
  };
}

/** Body with no `refreshToken` at all — TC-UAUTH-API-032 (missing required field). */
export const REFRESH_MISSING_TOKEN_BODY = {} as const;

// ---------------------------------------------------------------------------
// Validation matrices (login §3.2 step 1, forgot §3.2 step 1)
// ---------------------------------------------------------------------------

export interface LoginValidationCase {
  sub: string;
  overrides: Partial<LoginPayload>;
  field: "email" | "password";
  message: string;
}

/** TC-UAUTH-API-004 sub-cases 4a–4c — each maps to the exact §3.2 per-field message. */
export function loginValidationMatrix(): LoginValidationCase[] {
  return [
    { sub: "4a email empty", overrides: { email: "" }, field: "email", message: FIELD_MESSAGES.emailInvalid },
    { sub: "4b email invalid format", overrides: { email: "bad" }, field: "email", message: FIELD_MESSAGES.emailInvalid },
    { sub: "4c password empty", overrides: { password: "" }, field: "password", message: FIELD_MESSAGES.passwordRequired },
  ];
}

export interface ForgotValidationCase {
  sub: string;
  overrides: Partial<ForgotPasswordPayload>;
  message: string;
}

/** TC-UAUTH-API-024 sub-cases 24a–24b — invalid/empty email → email field message. */
export function forgotValidationMatrix(): ForgotValidationCase[] {
  return [
    { sub: "24a email empty", overrides: { email: "" }, message: FIELD_MESSAGES.emailInvalid },
    { sub: "24b email invalid format", overrides: { email: "bad" }, message: FIELD_MESSAGES.emailInvalid },
  ];
}
