/**
 * HTTP client for CEIQ-FEAT-009 (Contracts) - endpoints under `/api/v1/contracts`.
 *
 * Routes are authoritatively defined by SPEC_CEIQ-FEAT-009-contracts.md Technical
 * section 4 (this feature spec OWNS them). All 19 endpoints sit behind JwtAuthGuard +
 * TenantContextInterceptor; the write endpoints additionally require
 * @RequireRight('manage_contracts') while the read endpoints accept
 * 'view_contracts'. Tenant scoping is automatic via RLS.
 *
 * Base URL comes from the env accessor (`apiBaseUrl()`), which already carries the
 * `/api/v1` prefix - no literal base URL here (secrets-and-env.rules section 1a).
 */
import axios, { type AxiosResponse } from "axios";
import FormData from "form-data";
import { apiBaseUrl } from "../config/env";

export const ENDPOINT_CONTRACTS = "/contracts";

/** The 5 contract-type slugs (spec 4.2 Endpoint #2 request table). */
export const CONTRACT_TYPES = [
  "msa_services",
  "purchase_agreement_goods",
  "subscription_agreement_saas",
  "vendor_agreement_general",
  "partnership_agreement",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/**
 * Authoritative family status enum (spec 3.1). `expiring_soon` is deliberately
 * NOT here: spec 9.4 makes it a LIST FILTER only, never a stored status and never
 * a badge value.
 */
export const CONTRACT_STATUSES = ["in_review", "active", "expired", "terminated"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Status-tab filter values accepted by Endpoint #1, which DO include expiring_soon. */
export const STATUS_FILTERS = [...CONTRACT_STATUSES, "expiring_soon"] as const;

/** Extraction status enum (spec 3.2). Exactly three values - there is no `processing`. */
export const EXTRACTION_STATUSES = ["pending", "completed", "failed"] as const;

/** Comparison status enum (spec 3.3). */
export const COMPARISON_STATUSES = ["pending", "completed", "failed"] as const;

const REQUEST_TIMEOUT_MS = Number(process.env.CONTRACTS_REQUEST_TIMEOUT_MS?.trim() || "25000");

export interface ListQuery {
  page?: number | string;
  limit?: number | string;
  status?: string;
  search?: string;
  contractType?: string | string[];
  sortBy?: string;
  sortOrder?: string;
}

export interface CreateContractOpts {
  contractType?: string;
  vendorId?: string;
  sourcingEventId?: string;
  /** Omit to exercise the missing-file negative path. */
  file?: { buffer: Buffer; filename: string; contentType: string };
}

export interface SaveReviewBody {
  [field: string]: unknown;
}

export class ContractsClient {
  /**
   * Resolved per request, not in the constructor.
   *
   * Eager resolution would read API_BASE_URL at module-import time, which in ESM
   * happens before any dotenv call in an entry script - so the client would throw
   * on import in any context that loads env itself. Lazy keeps the fail-loud
   * behaviour (secrets-and-env.rules section 1a) without dictating import order.
   */
  private get base(): string {
    return apiBaseUrl();
  }

  private headers(token?: string, extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json", ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  /**
   * Never throw on 4xx/5xx - every case asserts the status explicitly.
   *
   * `validateStatus: null` rather than `() => true`: axios treats null as
   * "accept every status", and unlike a closure it survives vitest's structured
   * clone when a failing test serializes the request config. A function here
   * produces "could not be cloned" unhandled errors that vitest warns can cause
   * false positives.
   */
  private opts(token?: string, extra: Record<string, string> = {}) {
    return {
      headers: this.headers(token, extra),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: null,
    } as never;
  }

  private jsonOpts(token?: string) {
    return this.opts(token, { "Content-Type": "application/json" });
  }

  /**
   * Serialize a multipart form to a Buffer rather than handing axios the stream.
   *
   * form-data's stream carries closures, and vitest structured-clones the request
   * config when it serializes test results - a stream there produces
   * "could not be cloned" unhandled errors that vitest warns can cause false
   * positives. A Buffer body is inert and clones cleanly.
   */
  private multipart(form: FormData): { body: Buffer; headers: Record<string, string> } {
    return { body: form.getBuffer(), headers: form.getHeaders() };
  }

  // --- Endpoint #1 -------------------------------------------------------
  /** GET /contracts - list contract families. */
  async list(token: string, query: ListQuery = {}): Promise<AxiosResponse> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((one) => params.append(k, String(one)));
      else params.append(k, String(v));
    }
    const qs = params.toString();
    return axios.get(`${this.base}${ENDPOINT_CONTRACTS}${qs ? `?${qs}` : ""}`, this.opts(token));
  }

  /** GET /contracts with a raw query string, for malformed-input cases. */
  async listRaw(token: string, rawQuery: string): Promise<AxiosResponse> {
    return axios.get(`${this.base}${ENDPOINT_CONTRACTS}?${rawQuery}`, this.opts(token));
  }

  // --- Endpoint #2 -------------------------------------------------------
  /** POST /contracts - create a new contract (multipart). */
  async create(token: string, o: CreateContractOpts): Promise<AxiosResponse> {
    const form = new FormData();
    if (o.file) form.append("file", o.file.buffer, { filename: o.file.filename, contentType: o.file.contentType });
    if (o.contractType !== undefined) form.append("contractType", o.contractType);
    if (o.vendorId !== undefined) form.append("vendorId", o.vendorId);
    if (o.sourcingEventId !== undefined) form.append("sourcingEventId", o.sourcingEventId);
    const m = this.multipart(form);
    return axios.post(`${this.base}${ENDPOINT_CONTRACTS}`, m.body, this.opts(token, m.headers));
  }

  // --- Endpoint #3 -------------------------------------------------------
  /** POST /contracts/:familyId/versions - upload a new version. */
  async uploadVersion(token: string, familyId: string, o: Omit<CreateContractOpts, "contractType">): Promise<AxiosResponse> {
    const form = new FormData();
    if (o.file) form.append("file", o.file.buffer, { filename: o.file.filename, contentType: o.file.contentType });
    if (o.vendorId !== undefined) form.append("vendorId", o.vendorId);
    if (o.sourcingEventId !== undefined) form.append("sourcingEventId", o.sourcingEventId);
    const m = this.multipart(form);
    return axios.post(`${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions`, m.body, this.opts(token, m.headers));
  }

  // --- Endpoint #4 -------------------------------------------------------
  /** POST /:familyId/versions/:versionId/update-contract - stage a replacement. */
  async updateContract(
    token: string,
    familyId: string,
    versionId: string,
    file?: CreateContractOpts["file"],
  ): Promise<AxiosResponse> {
    const form = new FormData();
    if (file) form.append("file", file.buffer, { filename: file.filename, contentType: file.contentType });
    const m = this.multipart(form);
    return axios.post(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/update-contract`,
      m.body,
      this.opts(token, m.headers),
    );
  }

  // --- Endpoints #5 to #9 ------------------------------------------------
  async extractionStatus(token: string, familyId: string, versionId: string): Promise<AxiosResponse> {
    return axios.get(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/extraction-status`,
      this.opts(token),
    );
  }

  async retryExtraction(token: string, familyId: string, versionId: string): Promise<AxiosResponse> {
    return axios.post(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/extraction/retry`,
      {},
      this.jsonOpts(token),
    );
  }

  async review(token: string, familyId: string, versionId: string): Promise<AxiosResponse> {
    return axios.get(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/review`,
      this.opts(token),
    );
  }

  async save(token: string, familyId: string, versionId: string, body: SaveReviewBody): Promise<AxiosResponse> {
    return axios.post(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/save`,
      body,
      this.jsonOpts(token),
    );
  }

  async deleteVersion(token: string, familyId: string, versionId: string): Promise<AxiosResponse> {
    return axios.delete(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}`,
      this.opts(token),
    );
  }

  // --- Endpoints #10 to #12 ----------------------------------------------
  async detail(token: string, familyId: string): Promise<AxiosResponse> {
    return axios.get(`${this.base}${ENDPOINT_CONTRACTS}/${familyId}`, this.opts(token));
  }

  async deleteFamily(token: string, familyId: string): Promise<AxiosResponse> {
    return axios.delete(`${this.base}${ENDPOINT_CONTRACTS}/${familyId}`, this.opts(token));
  }

  async terminate(token: string, familyId: string): Promise<AxiosResponse> {
    return axios.post(`${this.base}${ENDPOINT_CONTRACTS}/${familyId}/terminate`, {}, this.jsonOpts(token));
  }

  // --- Endpoints #13 to #17 ----------------------------------------------
  async versions(token: string, familyId: string, query: { page?: number | string; limit?: number | string } = {}): Promise<AxiosResponse> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.append(k, String(v));
    const qs = params.toString();
    return axios.get(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions${qs ? `?${qs}` : ""}`,
      this.opts(token),
    );
  }

  async activate(token: string, familyId: string, versionId: string, executionDate?: string | null): Promise<AxiosResponse> {
    const body: Record<string, unknown> = {};
    if (executionDate !== undefined) body.executionDate = executionDate;
    return axios.post(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/activate`,
      body,
      this.jsonOpts(token),
    );
  }

  /**
   * Start or retrieve a comparison.
   *
   * Spec Endpoint #15 takes two DISCRETE uuid fields, `versionIdA` and
   * `versionIdB` - not an array. An array body is rejected with 400
   * ERR_VALIDATION_FAILED, which silently blocks every comparison case.
   *
   * `extra` exists so negative cases can send a deliberately malformed body
   * (one id, three ids, identical ids) without the client second-guessing them.
   */
  async startComparison(
    token: string,
    familyId: string,
    versionIdA?: string,
    versionIdB?: string,
    extra?: Record<string, unknown>,
  ): Promise<AxiosResponse> {
    const body: Record<string, unknown> = { ...(extra ?? {}) };
    if (versionIdA !== undefined) body.versionIdA = versionIdA;
    if (versionIdB !== undefined) body.versionIdB = versionIdB;
    return axios.post(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/comparisons`,
      body,
      this.jsonOpts(token),
    );
  }

  async comparisonStatus(token: string, familyId: string, comparisonId: string): Promise<AxiosResponse> {
    return axios.get(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/comparisons/${comparisonId}`,
      this.opts(token),
    );
  }

  async fileUrl(token: string, familyId: string, versionId: string): Promise<AxiosResponse> {
    return axios.get(
      `${this.base}${ENDPOINT_CONTRACTS}/${familyId}/versions/${versionId}/file-url`,
      this.opts(token),
    );
  }

  // --- Endpoints #18 to #19 ----------------------------------------------
  async clauseComparison(token: string, familyId: string): Promise<AxiosResponse> {
    return axios.get(`${this.base}${ENDPOINT_CONTRACTS}/${familyId}/clause-comparison`, this.opts(token));
  }

  async risks(token: string, familyId: string): Promise<AxiosResponse> {
    return axios.get(`${this.base}${ENDPOINT_CONTRACTS}/${familyId}/risks`, this.opts(token));
  }

  /** Poll extraction until it leaves `pending`, or the budget expires. */
  async waitForExtraction(
    token: string,
    familyId: string,
    versionId: string,
    budgetMs = 180_000,
    intervalMs = 3_000,
  ): Promise<string | undefined> {
    // Only `completed` and `failed` are TERMINAL. Returning on "anything but pending"
    // also returned on the intermediate `processing`, so a caller would go straight to
    // Endpoint #8 and get 409 ERR_EXTRACTION_NOT_COMPLETED - the flaky "seed save failed"
    // that shows up whenever QA is under load and Stage 1 takes longer than one poll.
    const TERMINAL = new Set(["completed", "failed"]);
    const deadline = Date.now() + budgetMs;
    let last: string | undefined;
    while (Date.now() < deadline) {
      const r = await this.extractionStatus(token, familyId, versionId);
      last = r.data?.data?.extractionStatus ?? r.data?.data?.status;
      if (last && TERMINAL.has(last)) return last;
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    return last;
  }
}

export const contractsClient = new ContractsClient();
