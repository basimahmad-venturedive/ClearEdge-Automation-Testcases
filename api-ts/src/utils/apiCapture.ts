/**
 * Global axios request/response capture for the HTML report.
 *
 * Every client (controlPlaneClient, adminPortalClient, authClient, tokenProvider, …)
 * uses the shared `axios` singleton, so a single pair of interceptors installed once
 * records ALL HTTP traffic. Records land in a module-scoped buffer; vitest.setup.ts's
 * `afterEach` drains the buffer onto the current test's `task.meta.apiCalls`, which the
 * ExtentReporter reads back via `TestCase.meta()`.
 *
 * Secret redaction is applied by the reporter at render time (reporters/extentReporter.ts),
 * so raw values captured here never reach disk unredacted.
 */
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

export interface ApiCall {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  status: number | null;
  statusText: string;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  durationMs: number;
  /** Set only when the request failed at the network layer (no HTTP response). */
  error?: string;
}

const buffer: ApiCall[] = [];
let installed = false;

/** Normalize an axios headers bag (AxiosHeaders | plain object) into a flat string map. */
function headersToObject(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== "object") return out;
  const src =
    typeof (h as { toJSON?: () => unknown }).toJSON === "function"
      ? ((h as { toJSON: () => unknown }).toJSON() as Record<string, unknown>)
      : (h as Record<string, unknown>);
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** Body may arrive as an object (pre-transform) or a JSON string (post-transform). */
function parseBody(data: unknown): unknown {
  if (typeof data !== "string") return data ?? null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

interface StampedConfig extends InternalAxiosRequestConfig {
  __startTime?: number;
  __reqBody?: unknown;
}

function record(config: StampedConfig | undefined, response: AxiosResponse | undefined, error?: unknown): void {
  const start = config?.__startTime ?? Date.now();
  buffer.push({
    method: (config?.method ?? "get").toUpperCase(),
    url: config?.url ?? "(unknown)",
    requestHeaders: headersToObject(config?.headers),
    requestBody: parseBody(config?.__reqBody ?? config?.data),
    status: response?.status ?? null,
    statusText: response?.statusText ?? "",
    responseHeaders: headersToObject(response?.headers),
    responseBody: response?.data ?? null,
    durationMs: Date.now() - start,
    error: error ? String((error as Error)?.message ?? error) : undefined,
  });
}

/** Install the interceptors once. Safe to call from every setup-file evaluation. */
export function installApiCapture(): void {
  if (installed) return;
  installed = true;

  axios.interceptors.request.use((config) => {
    const stamped = config as StampedConfig;
    stamped.__startTime = Date.now();
    stamped.__reqBody = config.data; // captured before transformRequest stringifies it
    return config;
  });

  axios.interceptors.response.use(
    (response) => {
      record(response.config as StampedConfig, response);
      return response;
    },
    (error) => {
      record(error?.config as StampedConfig | undefined, error?.response as AxiosResponse | undefined, error);
      return Promise.reject(error);
    },
  );
}

/** Return everything captured since the last drain and reset the buffer. */
export function drainApiCalls(): ApiCall[] {
  return buffer.splice(0, buffer.length);
}
