/**
 * HTTP client for CEIQ-FOUND-001 (F1) control-plane + guard-contract tests.
 *
 * Endpoint paths below are confirmed against the real implementation in
 * codebase/clearedge-backend as of 2026-07-07 (dev team's latest pull from the dev
 * branch). Confirmed real routes (grep for @Controller/@Get/@Post/@Patch across
 * src/**\/*.controller.ts found exactly these three):
 *
 *   GET  /health                — health.controller.ts (no auth, VERSION_NEUTRAL, excluded from /api prefix)
 *   POST /api/v1/admin/tenants   — tenant.controller.ts (AdminJwtAuthGuard + PlatformAdminGuard)
 *   GET  /api/v1/user/me         — user.controller.ts (JwtAuthGuard, global)
 *
 * Everything else the F1 spec describes (tenant detail view, invite trigger, PO
 * reassignment, non-PO user CRUD, vendor portal, audit-log read, any @RequireRight
 * fixture route) has NO controller yet — those TODO_ENDPOINT_* constants remain
 * placeholders pending the Admin Portal / User Management feature specs (§1.3).
 * Do not invent a path and assert against it.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl, healthBaseUrl } from "../config/env";

// --- Confirmed real endpoints (codebase/clearedge-backend, 2026-07-07) ---
export const ENDPOINT_HEALTH = "/health";
// Moved to /admin/tenants in the CEIQ-FEAT-001 admin-portal merge (dev, 2026-07-10);
// was /tenants in the FOUND-001 scaffold.
export const ENDPOINT_TENANT_CREATE = "/admin/tenants";
export const ENDPOINT_USER_ME = "/user/me";

// --- Not yet implemented — Admin Portal feature spec owns these (SPEC §1.3) ---
export const TODO_ENDPOINT_TENANT_DETAIL = (tenantId: string): string => `/TODO/admin/tenants/${tenantId}`;
export const TODO_ENDPOINT_TENANT_INVITE_TRIGGER = (tenantId: string): string => `/TODO/admin/tenants/${tenantId}/invite`;
export const TODO_ENDPOINT_PO_REASSIGN = (tenantId: string): string => `/TODO/admin/tenants/${tenantId}/owner`;

// --- Not yet implemented — User Management feature spec owns these (SPEC §1.3) ---
export const TODO_ENDPOINT_USER_CREATE = "/TODO/tenant/users";
export const TODO_ENDPOINT_USER_DETAIL = (userId: string): string => `/TODO/tenant/users/${userId}`;
export const TODO_ENDPOINT_USER_LIST = "/TODO/tenant/users";

// --- Not yet implemented — Sourcing feature spec owns issuance/UI; F1 owns validation only ---
export const TODO_ENDPOINT_VENDOR_PORTAL = "/TODO/vendor-portal/session";

// --- Not yet implemented — no audit-log read endpoint exists; view_audit_logs right has no consumer route yet ---
export const TODO_ENDPOINT_AUDIT_TENANT = "/TODO/tenant/audit-logs";
export const TODO_ENDPOINT_AUDIT_PLATFORM = "/TODO/admin/audit-logs";

// --- Not yet implemented — no @RequireRight-guarded fixture route exists to exercise RightsGuard directly ---
export const TODO_ENDPOINT_FIXTURE_RIGHT = (right: string): string => `/TODO/fixture/${right}`;

export class ControlPlaneClient {
  private readonly base: string;

  constructor() {
    this.base = apiBaseUrl();
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async get<T = unknown>(path: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${path}`, { headers: this.headers(token), validateStatus: () => true });
  }

  async post<T = unknown>(path: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}${path}`, body, { headers: this.headers(token), validateStatus: () => true });
  }

  async patch<T = unknown>(path: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.patch<T>(`${this.base}${path}`, body, { headers: this.headers(token), validateStatus: () => true });
  }
}

export class HealthClient {
  async get(): Promise<AxiosResponse> {
    return axios.get(`${healthBaseUrl()}${ENDPOINT_HEALTH}`, { validateStatus: () => true });
  }
}
