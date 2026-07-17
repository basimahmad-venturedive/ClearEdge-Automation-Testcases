/**
 * HTTP client for CEIQ-FEAT-003 (User Management) — endpoints under `/api/v1/users`.
 *
 * Routes are authoritatively defined by SPEC_CEIQ-FEAT-003-user-management.md §4
 * (this feature spec OWNS them). All six require JwtAuthGuard + TenantContextInterceptor
 * + @RequireRight('manage_users') and use the F1 §9.2 { success, data|error } envelope.
 *
 * Base URL comes from the env accessor (`apiBaseUrl()`), which already carries the
 * `/api/v1` prefix (consistent with ControlPlaneClient's `/user/me`, `/admin/tenants`).
 * No literal base URL here (secrets-and-env.rules §1a).
 *
 * NOTE: The backend controllers for these routes are not yet deployed to any
 * environment QA can reach (§5/§8 TBD). The tests in tests/userManagement.test.ts
 * are therefore scaffolded with `test.skip` until a live environment + PO token exist.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

// --- Endpoints (SPEC §4.1) ---
export const ENDPOINT_MANAGEMENT_HOME = "/users/management-home";
export const ENDPOINT_USERS = "/users";
export const ENDPOINT_USER_DETAIL = (userId: string): string => `/users/${userId}`;
export const ENDPOINT_USER_STATUS = (userId: string): string => `/users/${userId}/status`;

export interface ListUsersQuery {
  search?: string;
  role?: "procurement_manager" | "procurement_analyst" | "";
  page?: number;
  limit?: number;
}

function buildQuery(query: ListUsersQuery): string {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.role !== undefined) params.set("role", query.role);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export class UserManagementClient {
  private readonly base: string;

  constructor() {
    this.base = apiBaseUrl();
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async managementHome<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${ENDPOINT_MANAGEMENT_HOME}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async listUsers<T = unknown>(query: ListUsersQuery = {}, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${ENDPOINT_USERS}${buildQuery(query)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async createUser<T = unknown>(body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}${ENDPOINT_USERS}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async getUser<T = unknown>(userId: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${ENDPOINT_USER_DETAIL(userId)}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async editUser<T = unknown>(userId: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.patch<T>(`${this.base}${ENDPOINT_USER_DETAIL(userId)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  async setStatus<T = unknown>(userId: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.patch<T>(`${this.base}${ENDPOINT_USER_STATUS(userId)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }
}
