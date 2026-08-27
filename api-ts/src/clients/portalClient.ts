/**
 * HTTP client for CEIQ-FEAT-008 (Vendor Submission Portal) — the four public,
 * unauthenticated endpoints under `/api/portal/:token` (SPEC §4.1):
 *
 *   GET    /api/portal/:token                          — resolve invitation
 *   POST   /api/portal/:token/attachments/upload-url   — request pending upload URL
 *   POST   /api/portal/:token/submit                   — submit proposal
 *   DELETE /api/portal/:token/submit                   — withdraw proposal
 *
 * There is NO Authorization header — the portal token in the path is the sole
 * credential (PortalTokenGuard, §7.1). The base URL comes from the env accessor
 * `portalApiBaseUrl()` (no literal host here — secrets-and-env.rules §1a); portal
 * routes sit at the origin under `/api/portal`, not under the `/api/v1` prefix.
 */
import axios, { type AxiosResponse } from "axios";
import { portalApiBaseUrl } from "../config/env";

export const ENDPOINT_PORTAL = "/api/portal";

const REQUEST_TIMEOUT_MS = Number(process.env.PORTAL_REQUEST_TIMEOUT_MS?.trim() || "25000");

export class PortalClient {
  private readonly base: string;

  constructor() {
    this.base = portalApiBaseUrl();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Accept: "application/json", "Content-Type": "application/json", ...(extra ?? {}) };
  }

  private url(token: string, suffix = ""): string {
    return `${this.base}${ENDPOINT_PORTAL}/${encodeURIComponent(token)}${suffix}`;
  }

  /** GET /api/portal/:token — resolve token → vendor-safe event/issuer/vendor/proposal. */
  async resolve<T = unknown>(token: string, extraHeaders?: Record<string, string>): Promise<AxiosResponse<T>> {
    return axios.get<T>(this.url(token), {
      headers: this.headers(extraHeaders),
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** POST /api/portal/:token/attachments/upload-url — presigned pending upload URL. */
  async requestUploadUrl<T = unknown>(token: string, body: unknown): Promise<AxiosResponse<T>> {
    return axios.post<T>(this.url(token, "/attachments/upload-url"), body, {
      headers: this.headers(),
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** POST /api/portal/:token/submit — submit a proposal (structured data + optional attachment metadata). */
  async submit<T = unknown>(token: string, body: unknown): Promise<AxiosResponse<T>> {
    return axios.post<T>(this.url(token, "/submit"), body, {
      headers: this.headers(),
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  /** DELETE /api/portal/:token/submit — withdraw the active submission (no request body). */
  async withdraw<T = unknown>(token: string): Promise<AxiosResponse<T>> {
    return axios.delete<T>(this.url(token, "/submit"), {
      headers: this.headers(),
      validateStatus: () => true,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }
}
