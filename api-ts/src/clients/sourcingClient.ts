/**
 * HTTP client for CEIQ-FEAT-007 (Sourcing Events) — endpoints under
 * `/api/v1/sourcing-events` (spec §5). JwtAuthGuard + TenantContextInterceptor +
 * @RequireRight (write=manage_sourcing, read=view_sourcing); F1 { success, data|error }
 * envelope. Base URL via apiBaseUrl() accessor — no literal URLs (secrets-and-env §1a).
 */
import axios, { type AxiosResponse } from "axios";
import { apiBaseUrl } from "../config/env";

const TIMEOUT = Number(process.env.SOURCING_REQUEST_TIMEOUT_MS?.trim() || "25000");

export const EVENT_TYPES = ["rfp", "rfq"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface ListQuery { page?: number; limit?: number; tab?: string; search?: string }

function qs(q: ListQuery): string {
  const p = new URLSearchParams();
  if (q.page != null) p.set("page", String(q.page));
  if (q.limit != null) p.set("limit", String(q.limit));
  if (q.tab) p.set("tab", q.tab);
  if (q.search) p.set("search", q.search);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export class SourcingClient {
  private readonly base: string;
  constructor() { this.base = apiBaseUrl(); }

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }
  private opts(token?: string) {
    return { headers: this.headers(token), validateStatus: () => true, timeout: TIMEOUT };
  }

  listEvents<T = unknown>(q: ListQuery = {}, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/sourcing-events${qs(q)}`, this.opts(token));
  }
  getEvent<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/sourcing-events/${id}`, this.opts(token));
  }
  generateDraft<T = unknown>(body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}/sourcing-events/generate`, body, this.opts(token));
  }
  createEmptyDraft<T = unknown>(body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}/sourcing-events`, body, this.opts(token));
  }
  updateEvent<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.patch<T>(`${this.base}/sourcing-events/${id}`, body, this.opts(token));
  }
  publishEvent<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}/sourcing-events/${id}/publish`, {}, this.opts(token));
  }
  deleteEvent<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.delete<T>(`${this.base}/sourcing-events/${id}`, this.opts(token));
  }
  retryGeneration<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}/sourcing-events/${id}/retry-generation`, {}, this.opts(token));
  }
  getInviteVendors<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/sourcing-events/${id}/vendors`, this.opts(token));
  }
  invite<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}/sourcing-events/${id}/invite`, body, this.opts(token));
  }
  updateNotes<T = unknown>(id: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.patch<T>(`${this.base}/sourcing-events/${id}/notes`, body, this.opts(token));
  }
  getProposals<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/sourcing-events/${id}/proposals`, this.opts(token));
  }
  getProposal<T = unknown>(id: string, proposalId: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/sourcing-events/${id}/proposals/${proposalId}`, this.opts(token));
  }
  award<T = unknown>(id: string, proposalId: string, body: unknown, token?: string): Promise<AxiosResponse<T>> {
    return axios.post<T>(`${this.base}/sourcing-events/${id}/proposals/${proposalId}/award`, body, this.opts(token));
  }
  getComparison<T = unknown>(id: string, token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/sourcing-events/${id}/comparison`, this.opts(token));
  }
  /** Category taxonomy (shared with Vendor Directory — sourcing categories come from vendor_categories, §8). */
  getCategories<T = unknown>(token?: string): Promise<AxiosResponse<T>> {
    return axios.get<T>(`${this.base}/vendor-categories`, this.opts(token));
  }
}
