/**
 * HTTP client for CEIQ-FEAT-001 (Admin Portal) — the 7 tenant-management endpoints
 * under /api/v1/admin/tenants (SPEC_CEIQ-FEAT-001-admin-portal.md §4.1/§4.2).
 *
 * None of these routes exist in codebase/clearedge-backend yet (as of 2026-07-08) —
 * paths are taken verbatim from the spec's Endpoint Summary. The base URL already
 * carries the /api/v1 prefix (same convention as controlPlaneClient.ts), so paths
 * here start at /admin/tenants. All auth is a Bearer admin JWT
 * (AdminJwtAuthGuard + PlatformAdminGuard) supplied per call.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

// --- Spec §4.1 endpoint paths (relative to API_BASE_URL, which includes /api/v1) ---
export const ENDPOINT_ADMIN_TENANTS = "/admin/tenants";
export const endpointAdminTenantDetail = (tenantId: string): string => `/admin/tenants/${tenantId}`;
export const endpointAdminTenantCompany = (tenantId: string): string => `/admin/tenants/${tenantId}/company`;
export const endpointAdminTenantStatus = (tenantId: string): string => `/admin/tenants/${tenantId}/status`;
export const endpointAdminTenantOwner = (tenantId: string): string => `/admin/tenants/${tenantId}/owner`;
export const endpointAdminTenantHandover = (tenantId: string): string => `/admin/tenants/${tenantId}/handover`;

/** Query parameters accepted by GET /admin/tenants (§4.2). Raw strings allowed so boundary tests can send page=0, whitespace search, etc. */
export interface TenantListQuery {
  search?: string;
  page?: number | string;
}

function buildQueryString(query: TenantListQuery = {}): string {
  const parts: string[] = [];
  if (query.search !== undefined) parts.push(`search=${encodeURIComponent(query.search)}`);
  if (query.page !== undefined) parts.push(`page=${encodeURIComponent(String(query.page))}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

export class AdminPortalClient {
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

  // --- Typed wrappers for the 7 spec endpoints ---

  /** GET /admin/tenants — list tenants (paginated, searchable). */
  async listTenants<T = unknown>(query: TenantListQuery = {}, token?: string): Promise<AxiosResponse<T>> {
    return this.get<T>(`${ENDPOINT_ADMIN_TENANTS}${buildQueryString(query)}`, token);
  }

  /** POST /admin/tenants — create tenant + Procurement Owner. */
  async createTenant<T = unknown>(body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.post<T>(ENDPOINT_ADMIN_TENANTS, body, token);
  }

  /** GET /admin/tenants/:id — tenant profile detail. */
  async getTenantDetail<T = unknown>(tenantId: string, token?: string): Promise<AxiosResponse<T>> {
    return this.get<T>(endpointAdminTenantDetail(tenantId), token);
  }

  /** PATCH /admin/tenants/:id/company — update company info. */
  async updateCompany<T = unknown>(tenantId: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.patch<T>(endpointAdminTenantCompany(tenantId), body, token);
  }

  /** PATCH /admin/tenants/:id/status — toggle active/inactive. */
  async updateStatus<T = unknown>(tenantId: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.patch<T>(endpointAdminTenantStatus(tenantId), body, token);
  }

  /** PATCH /admin/tenants/:id/owner — update Procurement Owner. */
  async updateOwner<T = unknown>(tenantId: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.patch<T>(endpointAdminTenantOwner(tenantId), body, token);
  }

  /** POST /admin/tenants/:id/handover — trigger invite & complete handover (no body). */
  async triggerHandover<T = unknown>(tenantId: string, token?: string): Promise<AxiosResponse<T>> {
    return this.post<T>(endpointAdminTenantHandover(tenantId), {}, token);
  }
}
