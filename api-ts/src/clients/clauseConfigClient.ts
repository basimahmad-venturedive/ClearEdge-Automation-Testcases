/**
 * HTTP client for CEIQ-FEAT-006 (Clause Configuration) — endpoints under
 * `/api/v1/clause-configuration`.
 *
 * Routes are authoritatively defined by SPEC_CEIQ-FEAT-006-clause-configuration.md
 * Technical §3 (this feature spec OWNS them). Both require JwtAuthGuard +
 * TenantContextInterceptor + @RequireRight('manage_clause_configuration') and use the
 * F1 §9.2 { success, data|error } envelope. Tenant scoping is automatic via RLS.
 *
 * Base URL comes from the env accessor (`apiBaseUrl()`), which already carries the
 * `/api/v1` prefix — no literal base URL here (secrets-and-env.rules §1a).
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

export const ENDPOINT_CLAUSE_CONFIG = "/clause-configuration";
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

const REQUEST_TIMEOUT_MS = Number(process.env.CLAUSE_REQUEST_TIMEOUT_MS?.trim() || "25000");

/** One item of the PUT bulk payload (all 16 catalog clauses must be sent). */
export interface ClausePutItem {
  clauseCatalogId: string;
  selected: boolean;
  standardClauseOptionId: string | null;
  riskLevel: string;
}

export class ClauseConfigClient {
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

  /** GET /api/v1/clause-configuration — full catalog + tenant config (16 clauses). */
  async getConfig<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}${ENDPOINT_CLAUSE_CONFIG}`, {
      headers: this.headers(token),
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** PUT /api/v1/clause-configuration — bulk update of all clauses in one transaction. */
  async putConfig<T = unknown>(body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.put<T>(`${this.base}${ENDPOINT_CLAUSE_CONFIG}`, body, {
      headers: this.headers(token),
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }
}
