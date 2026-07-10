/**
 * Shared response assertions — per .claude/rules/api-automation.rules.md.
 *
 * Every test that asserts against an HTTP response must call assertResponseTime;
 * every write (POST/PUT/PATCH) must call assertRequestEchoedInResponse or its
 * read-after-write counterpart.
 */
import type { AxiosResponse } from "axios";
import { expect } from "vitest";
import { maxResponseTimeS } from "../config/env";

const SERVER_GENERATED_FIELDS = new Set(["id", "createdAt", "updatedAt", "created_at", "updated_at", "token"]);

export function assertResponseTime(response: AxiosResponse, maxSeconds?: number): void {
  const limit = maxSeconds ?? maxResponseTimeS();
  const elapsedMs = Number(response.headers["x-response-time-ms"] ?? 0);
  const elapsedSeconds = elapsedMs / 1000;
  if (elapsedMs > 0) {
    expect(elapsedSeconds, `Response took ${elapsedSeconds.toFixed(3)}s, exceeding the ${limit.toFixed(1)}s SLA`).toBeLessThanOrEqual(
      limit,
    );
  }
}

export function assertRequestEchoedInResponse(
  payload: object,
  response: AxiosResponse,
  ignore: string[] = [],
): void {
  const ignored = new Set([...SERVER_GENERATED_FIELDS, ...ignore]);
  const body = response.data as Record<string, unknown>;
  const data = (body?.data ?? body) as Record<string, unknown>;
  const mismatches: Array<[string, unknown, unknown]> = [];

  for (const [key, expected] of Object.entries(payload)) {
    if (ignored.has(key)) continue;
    const actual = data?.[key];
    if (actual !== expected) {
      mismatches.push([key, expected, actual]);
    }
  }

  expect(mismatches, `Request body not echoed in response. Mismatches: ${JSON.stringify(mismatches)}`).toEqual([]);
}

export function assertErrorEnvelope(response: AxiosResponse, expectedCode: string): void {
  const body = response.data as { success: boolean; error?: { code: string } };
  expect(body.success).toBe(false);
  expect(body.error?.code).toBe(expectedCode);
}
