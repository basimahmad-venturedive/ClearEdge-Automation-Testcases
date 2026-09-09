/**
 * HTTP client for CEIQ-FEAT-011 (Dashboard) — the five read endpoints under
 * `/api/v1/dashboard` (spec Tech §3.1). All are protected by JwtAuthGuard +
 * TenantContextInterceptor + @RequireRight('view_dashboard') and return the F1
 * `{ success, data | error }` envelope. Base URL via apiBaseUrl() — no literal
 * URLs (secrets-and-env §1a).
 *
 * Every method takes `now` explicitly rather than defaulting it internally: the
 * spec's §4.1 single-reference-point contract only means anything if the *caller*
 * owns the timestamp, and several cases deliberately pass a shifted `now`.
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

const TIMEOUT = Number(process.env.DASHBOARD_REQUEST_TIMEOUT_MS?.trim() || "25000");

export interface CalendarRange {
  startDate?: string;
  endDate?: string;
  now?: string;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export class DashboardClient {
  private readonly base: string;
  constructor() {
    this.base = apiBaseUrl();
  }

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private opts(token?: string) {
    return { headers: this.headers(token), validateStatus: () => true, timeout: TIMEOUT };
  }

  summary<T = unknown>(now: string | undefined, token?: string, extra?: Record<string, string>): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/dashboard/summary${qs({ now, ...extra })}`, this.opts(token));
  }

  recentActivity<T = unknown>(now: string | undefined, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/dashboard/recent-activity${qs({ now })}`, this.opts(token));
  }

  calendarEvents<T = unknown>(range: CalendarRange, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/dashboard/calendar-events${qs(range as Record<string, string | undefined>)}`, this.opts(token));
  }

  renewals<T = unknown>(now: string | undefined, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/dashboard/renewals${qs({ now })}`, this.opts(token));
  }

  activeSourcing<T = unknown>(now: string | undefined, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/dashboard/active-sourcing${qs({ now })}`, this.opts(token));
  }

  /** Arbitrary path under the API base — used by the method/route negative cases. */
  raw<T = unknown>(method: "get" | "post" | "patch" | "delete", path: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.request<T>({ method, url: `${this.base}${path}`, ...this.opts(token) });
  }
}
