import axios, { type AxiosError, type AxiosRequestConfig } from "axios";

/** Transient, connection-level failures worth a second attempt. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNABORTED",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_NETWORK",
  "ECONNREFUSED",
]);

/** Methods that are safe to replay: a repeat cannot create or destroy anything. */
const IDEMPOTENT = new Set(["get", "head", "options"]);

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 750;

interface RetryConfig extends AxiosRequestConfig {
  __retryCount?: number;
}

/**
 * Retry read-only requests through transient network failures.
 *
 * Long QA runs intermittently drop a socket - `ECONNRESET`, or a TLS handshake
 * aborted with "Client network socket disconnected before secure TLS connection
 * was established". When that lands inside a polling loop such as
 * ContractsClient.waitForExtraction, the exception escapes a `beforeAll` and
 * vitest reports every case in that describe as SKIPPED. A skipped case reads as
 * coverage that does not exist, and hides whatever the tests would have found, so
 * a blip in the network must not be allowed to silently delete a whole describe.
 *
 * Only requests with NO response are retried, and only for idempotent methods: a
 * POST that reset after reaching the server may well have created a contract, and
 * replaying it would double-seed. Non-idempotent seeding is covered separately by
 * withSeedRetry() in contractsSeed.ts, which refreshes the token and retries once
 * at the seed level where a duplicate is detectable.
 */
export function installNetworkRetry(): void {
  axios.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
      const config = error.config as RetryConfig | undefined;
      if (!config || error.response) return Promise.reject(error);

      const code = String(error.code ?? "");
      const message = String(error.message ?? "");
      const transient =
        TRANSIENT_CODES.has(code) || /socket disconnected|socket hang up|network error/i.test(message);
      const method = String(config.method ?? "get").toLowerCase();
      if (!transient || !IDEMPOTENT.has(method)) return Promise.reject(error);

      const attempt = (config.__retryCount ?? 0) + 1;
      if (attempt >= MAX_ATTEMPTS) return Promise.reject(error);
      config.__retryCount = attempt;

      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * attempt));
      return axios.request(config);
    },
  );
}
