/**
 * Network helpers: request counters (assert that a call did / did not fire)
 * and route mocks (forced failures, injected latency). Used by page objects —
 * specs interact through page-object methods only.
 */
import type { Page, Request, Route } from '@playwright/test';

export interface RequestCounter {
  /** Number of matching requests observed since tracking started. */
  count(): number;
  /** Detach the listener. */
  stop(): void;
}

/** Count requests matching a predicate (e.g. to assert "no PATCH /status fired"). */
export function trackRequests(page: Page, predicate: (request: Request) => boolean): RequestCounter {
  let matched = 0;
  const listener = (request: Request): void => {
    if (predicate(request)) {
      matched += 1;
    }
  };
  page.on('request', listener);
  return {
    count: (): number => matched,
    stop: (): void => {
      page.off('request', listener);
    },
  };
}

/** Count requests by HTTP method + URL fragment (path template from utils/apiPaths.ts). */
export function trackApiRequests(page: Page, method: string, urlFragment: string): RequestCounter {
  return trackRequests(
    page,
    (request) => request.method() === method && request.url().includes(urlFragment),
  );
}

export type MockFailureKind = 'http-error' | 'abort';

export interface MockFailureOptions {
  urlFragment: string;
  method: string;
  kind: MockFailureKind;
  /** HTTP status for kind 'http-error' (default 500). */
  status?: number;
}

/**
 * Force an API failure for matching requests (TC-ADMUX-001).
 * Returns an async restore function that removes the mock.
 */
export async function mockApiFailure(
  page: Page,
  options: MockFailureOptions,
): Promise<() => Promise<void>> {
  const { urlFragment, method, kind, status = 500 } = options;
  const urlMatcher = (url: URL): boolean => url.pathname.includes(urlFragment);
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() !== method) {
      await route.fallback();
      return;
    }
    if (kind === 'abort') {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      // Generic §9 error envelope shape — no internal details.
      body: JSON.stringify({ success: false, error: { code: 'ERR_INTERNAL', message: 'Internal server error', details: {} } }),
    });
  };
  await page.route(urlMatcher, handler);
  return async (): Promise<void> => {
    await page.unroute(urlMatcher, handler);
  };
}

/**
 * Inject latency into matching API responses (TC-ADMUX-002 loading states).
 * The setTimeout below simulates MOCK-SERVER latency inside the route handler;
 * it is not a test-synchronization sleep (those are banned) — the test itself
 * still waits on auto-retrying expect() conditions.
 */
export async function delayApiResponse(
  page: Page,
  urlFragment: string,
  method: string,
  delayMs: number,
): Promise<() => Promise<void>> {
  const urlMatcher = (url: URL): boolean => url.pathname.includes(urlFragment);
  const handler = async (route: Route): Promise<void> => {
    if (route.request().method() !== method) {
      await route.fallback();
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    await route.continue();
  };
  await page.route(urlMatcher, handler);
  return async (): Promise<void> => {
    await page.unroute(urlMatcher, handler);
  };
}
