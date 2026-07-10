/** Structured logger with sensitive-header redaction — never use console.log for request/response dumps. */

const REDACTED_HEADERS = new Set(["authorization", "x-api-key", "cookie", "set-cookie"]);

export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "<redacted>" : value;
  }
  return redacted;
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>): void => {
    // eslint-disable-next-line no-console
    console.info(`[INFO] ${message}`, meta ? redactHeaders(meta) : "");
  },
  error: (message: string, meta?: Record<string, unknown>): void => {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${message}`, meta ? redactHeaders(meta) : "");
  },
};
