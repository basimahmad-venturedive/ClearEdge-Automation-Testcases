/**
 * HTTP client for CEIQ-FEAT-004 (Company Settings) — endpoints under
 * `/api/v1/company-settings`.
 *
 * Routes are authoritatively defined by SPEC_CEIQ-FEAT-004-company-settings.md
 * Technical §3 (this feature spec OWNS them). Both require JwtAuthGuard +
 * TenantContextInterceptor + @RequireRight('manage_company_settings') and use the
 * F1 §9.2 { success, data|error } envelope. Tenant scoping is automatic via RLS.
 *
 * Base URL comes from the env accessor (`apiBaseUrl()`), which already carries the
 * `/api/v1` prefix. No literal base URL here (secrets-and-env.rules §1a).
 *
 * NOTE: The backend controllers for these routes are not yet deployed to any
 * environment QA can reach (§5/§9 TBD). The tests in tests/companySettings.test.ts
 * are therefore scaffolded with `test.skip` until a live environment + a PO token
 * with `manage_company_settings` exist.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

// --- Endpoints (SPEC §3.1) ---
export const ENDPOINT_COMPANY_SETTINGS = "/company-settings";
export const ENDPOINT_COMPANY_SETTINGS_SECTION = (sectionKey: string): string =>
  `/company-settings/${sectionKey}`;

/** The three canonical section keys (SPEC §2.1 CHECK allow-list). */
export const SECTION_KEYS = ["background", "introduction", "terms_and_conditions"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export class CompanySettingsClient {
  private readonly base: string;

  constructor() {
    this.base = apiBaseUrl();
  }

  private headers(token?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /** GET /api/v1/company-settings — all three sections for the current tenant. */
  async getAll<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${ENDPOINT_COMPANY_SETTINGS}`, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }

  /**
   * PUT /api/v1/company-settings/:sectionKey — upsert one section.
   * `sectionKey` is passed as-is (invalid values are exercised on purpose in the
   * negative cases, so this method does not pre-validate).
   */
  async putSection<T = unknown>(
    sectionKey: string,
    body: unknown,
    token?: string,
  ): Promise<AxiosResponse<T>> {
    return axios.put<T>(`${this.base}${ENDPOINT_COMPANY_SETTINGS_SECTION(sectionKey)}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
    });
  }
}
