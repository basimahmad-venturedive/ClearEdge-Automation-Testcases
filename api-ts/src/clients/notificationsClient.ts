/**
 * HTTP client for CEIQ-FEAT-012 (Notification Centre) — the five endpoints under
 * `/api/v1/notifications` (spec Tech §3.1):
 *
 *   #1  GET    /notifications            — the panel (notifications, unreadCount, totalUndismissed)
 *   #2  PATCH  /notifications/:id/read   — mark one read for the caller (idempotent)
 *   #3  DELETE /notifications/:id        — dismiss one for the caller, returns the refreshed panel
 *   #4  DELETE /notifications            — clear all for the caller, returns the empty panel
 *   #5  GET    /notifications/stream     — SSE (NOT deployed on dev — 404; see D-3 / CLRE-387)
 *
 * All five are protected by JwtAuthGuard + TenantContextInterceptor +
 * @RequireRight('view_notifications') and return the F1 `{ success, data | error }`
 * envelope. Base URL via apiBaseUrl() — no literal URLs (secrets-and-env §1a), and the
 * token is always an explicit argument so a case can deliberately call as another actor,
 * with a malformed credential, or with none at all.
 *
 * `stream()` deliberately does NOT consume the event stream: an SSE response never ends,
 * so it opens the request, captures status + headers, destroys the socket and returns.
 * A short independent timeout (NOTIFICATIONS_STREAM_TIMEOUT_MS) keeps it from hanging the
 * runner even if endpoint #5 is later deployed and starts holding the connection open.
 */
import axios, { type AxiosResponse, type Method } from "axios";
import { apiBaseUrl } from "../config/env";

const TIMEOUT = Number(process.env.NOTIFICATIONS_REQUEST_TIMEOUT_MS?.trim() || "25000");
/** The stream probe must never hang: it only needs the response head. */
const STREAM_TIMEOUT = Number(process.env.NOTIFICATIONS_STREAM_TIMEOUT_MS?.trim() || "5000");

export interface StreamProbe {
  /** HTTP status, or 0 when the request never produced a response head (timeout/abort). */
  status: number;
  headers: Record<string, string>;
  /** Transport-level failure message when `status` is 0. */
  error?: string;
}

export class NotificationsClient {
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

  /** Endpoint #1 — the whole panel for the caller. Read-only (BR-06). */
  list<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/notifications`, this.opts(token));
  }

  /** Endpoint #2 — mark one notification read for the caller. Takes no request body. */
  markRead<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.patch<T>(`${this.base}/notifications/${id}/read`, undefined, this.opts(token));
  }

  /** Endpoint #3 — dismiss one notification for the caller. IRREVERSIBLE (BR-07). */
  dismiss<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.delete<T>(`${this.base}/notifications/${id}`, this.opts(token));
  }

  /** Endpoint #4 — dismiss every notification for the caller. IRREVERSIBLE (BR-07, §2.3). */
  clearAll<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return axios.delete<T>(`${this.base}/notifications`, this.opts(token));
  }

  /**
   * Endpoint #5 — open the SSE stream, read the response head, and hang up immediately.
   * Never awaits the body: an event stream has no end, so consuming it would block forever.
   */
  async stream(token?: string, timeoutMs: number = STREAM_TIMEOUT): Promise<StreamProbe> {
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await axios.get(`${this.base}/notifications/stream`, {
        headers: this.headers(token),
        validateStatus: () => true,
        responseType: "stream",
        signal: controller.signal,
        timeout: timeoutMs,
      });
      const body = res.data as { destroy?: () => void } | undefined;
      if (body && typeof body.destroy === "function") body.destroy();
      return {
        status: res.status,
        headers: (res.headers ?? {}) as unknown as Record<string, string>,
      };
    } catch (err) {
      return { status: 0, headers: {}, error: (err as Error).message };
    } finally {
      clearTimeout(abort);
    }
  }

  /** Arbitrary method/path under the API base — used by the method-matrix negative cases. */
  raw<T = unknown>(method: Method, path: string, token?: string, body?: unknown): Promise<AxiosResponse<T>> {
    return axios.request<T>({ method, url: `${this.base}${path}`, data: body, ...this.opts(token) });
  }

  /**
   * A request carrying a literal `Authorization` header value — the only way to exercise
   * "a valid token with the `Bearer ` scheme omitted" (TC-NOTSEC-002 credential (c)).
   */
  withRawAuth<T = unknown>(method: Method, path: string, authorization: string): Promise<AxiosResponse<T>> {
    return axios.request<T>({
      method,
      url: `${this.base}${path}`,
      headers: { Accept: "application/json", Authorization: authorization },
      validateStatus: () => true,
      timeout: TIMEOUT,
    });
  }
}
