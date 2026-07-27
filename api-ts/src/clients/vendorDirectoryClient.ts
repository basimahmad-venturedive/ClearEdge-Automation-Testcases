/**
 * HTTP client for CEIQ-FEAT-005 (Vendor Directory) — endpoints under
 * `/api/v1/vendors*` plus the system-wide `/api/v1/vendor-categories` lookup.
 *
 * Routes are authoritatively defined by SPEC_CEIQ-FEAT-005-vendor-directory.md §5.1
 * (this feature spec OWNS them). All require JwtAuthGuard + TenantContextInterceptor;
 * write routes require @RequireRight('manage_vendors'), read routes @RequireRight('view_vendors'),
 * and the four Sourcing-adjacent routes require dual rights (§5.1 / SR-001). All responses use
 * the F1 §9.2 { success, data|error } envelope. Tenant scoping is automatic via RLS.
 *
 * Base URL comes from the env accessor (`apiBaseUrl()`), which already carries the `/api/v1`
 * prefix. No literal base URL here (secrets-and-env.rules §1a). Negative cases pass invalid
 * path segments (bad :type, non-UUID :id) on purpose, so the methods do not pre-validate.
 */
import axios, { type AxiosInstance, type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

/**
 * Hard per-request timeout (ms). The dev `GET /api/v1/vendors` list route currently HANGS
 * (it blocks on the not-built Contracts service enrichment, §5/§12), so a bounded timeout makes
 * list-dependent cases FAIL FAST as a real timeout/response-time violation instead of stalling
 * the whole suite. Overridable via VENDOR_REQUEST_TIMEOUT_MS. Well under the vitest 30s testTimeout.
 */
export const REQUEST_TIMEOUT_MS = Number(process.env.VENDOR_REQUEST_TIMEOUT_MS?.trim() || "6000");

// --- Endpoints (SPEC §5.1) ---
export const ENDPOINT_VENDORS = "/vendors";
export const ENDPOINT_VENDOR = (id: string): string => `/vendors/${id}`;
export const ENDPOINT_VENDOR_STATUS = (id: string): string => `/vendors/${id}/status`;
export const ENDPOINT_VENDOR_PRIMARY = (id: string): string => `/vendors/${id}/primary`;
export const ENDPOINT_VENDOR_PREVIOUS_SPEND = (id: string): string => `/vendors/${id}/previous-spend`;
export const ENDPOINT_VENDOR_DOCUMENT = (id: string, type: string): string => `/vendors/${id}/documents/${type}`;
export const ENDPOINT_VENDOR_DOCUMENT_CONFIRM = (id: string, type: string): string =>
  `/vendors/${id}/documents/${type}/confirm`;
export const ENDPOINT_VENDOR_DOCUMENT_URL = (id: string, type: string): string =>
  `/vendors/${id}/documents/${type}/url`;
export const ENDPOINT_VENDOR_CONTRACTS = (id: string): string => `/vendors/${id}/contracts`;
export const ENDPOINT_VENDOR_HISTORY = (id: string): string => `/vendors/${id}/history`;
export const ENDPOINT_VENDOR_AWARDS = (id: string): string => `/vendors/${id}/awards`;
export const ENDPOINT_VENDOR_UPCOMING_ACTIONS = (id: string): string => `/vendors/${id}/upcoming-actions`;
export const ENDPOINT_VENDOR_INVITE = (id: string): string => `/vendors/${id}/invite`;
export const ENDPOINT_VENDOR_CATEGORIES = "/vendor-categories";

/** Document types the API accepts (§5.2 / §6 `ERR_INVALID_DOCUMENT_TYPE`). */
export const DOCUMENT_TYPES = ["w9", "coi"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface ListVendorsQuery {
  search?: string;
  categoryId?: string;
  primaryOnly?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

function buildQuery(query: ListVendorsQuery): string {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.categoryId !== undefined) params.set("categoryId", query.categoryId);
  if (query.primaryOnly !== undefined) params.set("primaryOnly", String(query.primaryOnly));
  if (query.sortBy !== undefined) params.set("sortBy", query.sortBy);
  if (query.sortOrder !== undefined) params.set("sortOrder", query.sortOrder);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export class VendorDirectoryClient {
  private readonly base: string;
  private readonly http: AxiosInstance;

  constructor() {
    this.base = apiBaseUrl();
    this.http = axios.create({ timeout: REQUEST_TIMEOUT_MS });
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  // ── Vendor CRUD ────────────────────────────────────────────────────────────
  async createVendor<T = unknown>(body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.http.post<T>(`${this.base}${ENDPOINT_VENDORS}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async listVendors<T = unknown>(query: ListVendorsQuery = {}, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDORS}${buildQuery(query)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getVendor<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async updateVendor<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.http.put<T>(`${this.base}${ENDPOINT_VENDOR(id)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async deleteVendor<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.delete<T>(`${this.base}${ENDPOINT_VENDOR(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  // ── Status / primary / previous-spend ────────────────────────────────────────
  async setStatus<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.http.patch<T>(`${this.base}${ENDPOINT_VENDOR_STATUS(id)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async setPrimary<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.http.patch<T>(`${this.base}${ENDPOINT_VENDOR_PRIMARY(id)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async setPreviousSpend<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.http.put<T>(`${this.base}${ENDPOINT_VENDOR_PREVIOUS_SPEND(id)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  // ── Compliance documents (S3 presigned flow) ────────────────────────────────
  async requestUploadUrl<T = unknown>(
    id: string,
    type: string,
    body: unknown,
    token?: string,
  ): Promise<AxiosResponse<T>> {
    return this.http.post<T>(`${this.base}${ENDPOINT_VENDOR_DOCUMENT(id, type)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async confirmUpload<T = unknown>(
    id: string,
    type: string,
    body: unknown,
    token?: string,
  ): Promise<AxiosResponse<T>> {
    return this.http.patch<T>(`${this.base}${ENDPOINT_VENDOR_DOCUMENT_CONFIRM(id, type)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async deleteDocument<T = unknown>(id: string, type: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.delete<T>(`${this.base}${ENDPOINT_VENDOR_DOCUMENT(id, type)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getDocumentUrl<T = unknown>(id: string, type: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_DOCUMENT_URL(id, type)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  // ── Sourcing / Contracts-delegating endpoints (stubbed §1.2) ─────────────────
  async getContracts<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_CONTRACTS(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getHistory<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_HISTORY(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getAwards<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_AWARDS(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getUpcomingActions<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_UPCOMING_ACTIONS(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async invite<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return this.http.post<T>(`${this.base}${ENDPOINT_VENDOR_INVITE(id)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getInviteData<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_INVITE(id)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  // ── Category taxonomy (system-wide lookup) ───────────────────────────────────
  async getCategories<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return this.http.get<T>(`${this.base}${ENDPOINT_VENDOR_CATEGORIES}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }
}
