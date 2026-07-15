/**
 * HTTP client for CEIQ-FEAT-002 (User Authentication) — the 5 public/bearer endpoints
 * under /api/v1/auth (SPEC_CEIQ-FEAT-002-user-auth.md §3.1/§3.2).
 *
 * None of these routes exist in codebase/clearedge-backend yet, and the local JWKS
 * mock does not implement the Cognito flows they proxy (InitiateAuth /
 * RespondToAuthChallenge / AdminGetUser / AdminSetUserPassword / GlobalSignOut), as of
 * 2026-07-14. Paths are taken verbatim from the spec's §3.1 Endpoint Summary. The base
 * URL already carries the /api/v1 prefix (same convention as adminPortalClient.ts /
 * controlPlaneClient.ts), so paths here start at /auth. Login, set-password,
 * forgot-password, and refresh are public (no Authorization header); logout requires a
 * Bearer access token supplied per call.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

// --- Spec §3.1 endpoint paths (relative to API_BASE_URL, which includes /api/v1) ---
export const ENDPOINT_AUTH_LOGIN = "/auth/login";
export const ENDPOINT_AUTH_SET_PASSWORD = "/auth/set-password";
export const ENDPOINT_AUTH_FORGOT_PASSWORD = "/auth/forgot-password";
export const ENDPOINT_AUTH_REFRESH = "/auth/refresh";
export const ENDPOINT_AUTH_LOGOUT = "/auth/logout";

export class AuthClient {
  private readonly base: string;

  constructor() {
    this.base = apiBaseUrl();
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async post<T = unknown>(path: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}${path}`, body, { headers: this.headers(token), validateStatus: () => true });
  }

  // --- Typed wrappers for the 5 spec endpoints ---

  /** POST /auth/login — authenticate via Cognito (public). §3.2 login. */
  async login<T = unknown>(body: unknown): Promise<AxiosResponse<T>> {
    return this.post<T>(ENDPOINT_AUTH_LOGIN, body);
  }

  /** POST /auth/set-password — complete the NEW_PASSWORD_REQUIRED challenge (public). §3.2 set-password. */
  async setPassword<T = unknown>(body: unknown): Promise<AxiosResponse<T>> {
    return this.post<T>(ENDPOINT_AUTH_SET_PASSWORD, body);
  }

  /** POST /auth/forgot-password — trigger temp password + email (public, non-disclosure). §3.2 forgot-password. */
  async forgotPassword<T = unknown>(body: unknown): Promise<AxiosResponse<T>> {
    return this.post<T>(ENDPOINT_AUTH_FORGOT_PASSWORD, body);
  }

  /** POST /auth/refresh — exchange a refresh token for a new access/id token (public). §3.2 refresh. */
  async refresh<T = unknown>(body: unknown): Promise<AxiosResponse<T>> {
    return this.post<T>(ENDPOINT_AUTH_REFRESH, body);
  }

  /** POST /auth/logout — GlobalSignOut for the caller (Bearer access token, no body). §3.2 logout. */
  async logout<T = unknown>(accessToken?: string): Promise<AxiosResponse<T>> {
    return this.post<T>(ENDPOINT_AUTH_LOGOUT, undefined, accessToken);
  }
}
