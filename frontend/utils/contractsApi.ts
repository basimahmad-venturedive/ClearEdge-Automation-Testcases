/**
 * Discover contract families that satisfy a spec's precondition, instead of requiring a
 * hand-set env var pointing at a seeded id.
 *
 * The CLRE-217 specs were gated on `CLRE217_FAMILY_ID` / `CLRE217_NO_ACTIVE_FAMILY_ID`, so they
 * skipped on every run nobody had exported them — which is every CI run. QA already holds both
 * shapes (probed 2026-09-10: 6 of 6 sampled `status=active` families have an Active version, and
 * `status=in_review` yields families with versions but none Active), so the precondition is
 * discoverable at runtime and the tests can just run.
 *
 * An explicit env var still wins when set, so a targeted re-test can pin an exact family.
 *
 * Only families whose DETAIL endpoint answers 200 are returned: a family with no saved
 * representative version 404s there (spec v1.7 §9.5) and its page cannot be opened in the UI, so
 * handing one to a UI spec would fail for a reason unrelated to what the spec is testing.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { appApiBaseUrl } from './env';
import { readAppIdToken } from './appApi';

export interface FamilyProbe {
  familyId: string;
  contractId?: string;
  hasActiveVersion: boolean;
  versionCount: number;
}

const base = (): string => appApiBaseUrl().replace(/\/$/, '');

async function authHeaders(page: Page): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await readAppIdToken(page)}`, 'Content-Type': 'application/json' };
}

/** List families in one lifecycle status. */
async function list(
  page: Page,
  request: APIRequestContext,
  status: string,
  limit = 10,
): Promise<Array<{ familyId: string; contractId?: string }>> {
  const res = await request.get(`${base()}/v1/contracts?page=1&limit=${limit}&status=${status}`, {
    headers: await authHeaders(page),
  });
  if (!res.ok()) return [];
  const json = (await res.json()) as { data?: { contracts?: Array<{ familyId: string; contractId?: string }> } };
  return json.data?.contracts ?? [];
}

/** Detail must be servable, and the versions call tells us whether an Active version exists. */
async function probe(page: Page, request: APIRequestContext, familyId: string): Promise<FamilyProbe | null> {
  const headers = await authHeaders(page);
  const detail = await request.get(`${base()}/v1/contracts/${familyId}`, { headers });
  if (!detail.ok()) return null;
  const versions = await request.get(`${base()}/v1/contracts/${familyId}/versions`, { headers });
  if (!versions.ok()) return null;
  const json = (await versions.json()) as {
    data?: { hasActiveVersion?: boolean; versions?: unknown[] };
  };
  return {
    familyId,
    hasActiveVersion: Boolean(json.data?.hasActiveVersion),
    versionCount: (json.data?.versions ?? []).length,
  };
}

/** A family with an Active version — `status=active` is the fast path to one. */
export async function findFamilyWithActiveVersion(
  page: Page,
  request: APIRequestContext,
): Promise<string | null> {
  for (const status of ['active', 'expiring_soon']) {
    for (const row of await list(page, request, status)) {
      const p = await probe(page, request, row.familyId);
      if (p?.hasActiveVersion) return p.familyId;
    }
  }
  return null;
}

/** A family that has saved versions but none Active — the `in_review` shape. */
export async function findFamilyWithoutActiveVersion(
  page: Page,
  request: APIRequestContext,
): Promise<string | null> {
  for (const row of await list(page, request, 'in_review', 25)) {
    const p = await probe(page, request, row.familyId);
    if (p && !p.hasActiveVersion && p.versionCount > 0) return p.familyId;
  }
  return null;
}

/**
 * Create a contract the caller may destroy, and leave it in a state the UI can open.
 *
 * The CLRE-324 delete spec needs a family it is allowed to delete. Pointing it at an existing
 * one would destroy real QA data, and the hundreds of stranded `in_review` uploads are no use
 * either — their detail 404s (spec v1.7 §9.5), so the page will not render and the Delete button
 * never appears. So the spec seeds its own: upload, wait for Stage 1, then SAVE, which is what
 * makes Endpoint #10 serve the family. Net effect on the tenant is zero — the test deletes it.
 *
 * Returns null if Stage 1 does not complete (CLRE-398 territory), so the caller can fail with a
 * reason rather than time out on a Delete button that was never going to appear.
 */
export async function seedDisposableFamily(
  page: Page,
  request: APIRequestContext,
  pdfPath: string,
  timeoutMs = 180_000,
): Promise<string | null> {
  const fs = await import('node:fs');
  const headers = await authHeaders(page);
  const auth = { Authorization: headers.Authorization as string };

  const created = await request.post(`${base()}/v1/contracts`, {
    headers: auth,
    multipart: {
      contractType: 'msa_services',
      file: { name: 'clre324-disposable.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(pdfPath) },
    },
  });
  if (!created.ok()) return null;
  const { data } = (await created.json()) as { data: { familyId: string; versionId: string } };
  const { familyId, versionId } = data;

  // Stage 1 must reach a TERMINAL state before save — `processing` is not terminal, and saving
  // then answers 409 ERR_EXTRACTION_NOT_COMPLETED.
  const deadline = Date.now() + timeoutMs;
  let status = '';
  while (Date.now() < deadline) {
    const r = await request.get(`${base()}/v1/contracts/${familyId}/versions/${versionId}/extraction-status`, { headers });
    status = r.ok() ? (((await r.json()) as { data?: { extractionStatus?: string } }).data?.extractionStatus ?? '') : '';
    if (status === 'completed' || status === 'failed') break;
    await page.waitForTimeout(5_000);
  }
  if (status !== 'completed') return null;

  const review = await request.get(`${base()}/v1/contracts/${familyId}/versions/${versionId}/review`, { headers });
  if (!review.ok()) return null;
  const body = ((await review.json()) as { data?: Record<string, unknown> }).data ?? {};
  const fields = (body as { fields?: Record<string, unknown> }).fields ?? body;
  const saved = await request.post(`${base()}/v1/contracts/${familyId}/versions/${versionId}/save`, {
    headers,
    data: fields,
  });
  if (!saved.ok()) return null;
  return familyId;
}
