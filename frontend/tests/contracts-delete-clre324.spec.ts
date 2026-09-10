/**
 * CLRE-324 retest — deleting a contract from the UI must not report failure.
 *
 * Original defect (QA, 2026-08-27): on /contracts/{familyId}, Delete →
 * "Delete permanently" fired DELETE /api/v1/contracts/{familyId}, which answered
 * 500 ERR_INTERNAL_SERVER_ERROR. The row was deleted anyway, so the UI showed
 * "Failed to delete contract." for an operation that had actually succeeded.
 * API twin: CLRE-330.
 *
 * The family is seeded out-of-band (automation/api-ts scripts/seed-contract-qa.ts)
 * and passed in as CLRE324_FAMILY_ID — seeding a contract needs a multipart upload
 * plus a Stage 1 extraction wait, which does not belong in a UI spec.
 *
 * Runs under the `po` project (Procurement Owner storageState). Navigation goes
 * through the app origin (APP_BASE_URL), not the admin baseURL.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { appBaseUrl } from '../utils/env';
import { seedDisposableFamily } from '../utils/contractsApi';

const DISPOSABLE_PDF = path.resolve(
  __dirname,
  '../../api-ts/tests/fixtures/contracts/subscription_agreement_review_dummy_data.pdf',
);

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;

test.describe('CLRE-324 — delete contract from the contract detail page', () => {
  test('deleting a contract reports success, not "Failed to delete contract."', async ({ page, request }) => {
    test.setTimeout(300_000);

    // Seed a throwaway contract rather than deleting real QA data, and rather than sitting
    // behind CLRE324_FAMILY_ID — an env var nobody exports in CI, so this regression guard
    // never actually ran. The seeder saves the version too: without a saved representative
    // version Endpoint #10 404s (spec v1.7 §9.5), the detail page never renders and the Delete
    // button never appears. Net effect on the tenant is zero — this test removes what it made.
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45000 });
    const familyId =
      process.env.CLRE324_FAMILY_ID?.trim() || (await seedDisposableFamily(page, request, DISPOSABLE_PDF));
    expect(
      familyId,
      'could not seed a deletable contract — Stage 1 extraction did not complete (see CLRE-398)',
    ).toBeTruthy();

    const deleteCalls: { status: number; body: string }[] = [];
    page.on('response', async (res) => {
      if (res.request().method() === 'DELETE' && res.url().includes(`/contracts/${familyId}`)) {
        deleteCalls.push({ status: res.status(), body: await res.text().catch(() => '') });
      }
    });

    // Boot the SPA on the app origin first so the persisted session rehydrates,
    // then deep-link to the contract (a cold goto races the client-side guard).
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45000 });
    await page.goto(appUrl(`/contracts/${familyId}`));

    // antd buttons expose "<icon-alt> <label>" as the accessible name, so the
    // detail-page action reads "delete Delete" — anchored so it cannot also match
    // the modal's "Delete permanently".
    const deleteButton = page.getByRole('button', { name: /^delete Delete$/ });
    await expect(deleteButton).toBeVisible({ timeout: 30000 });
    await deleteButton.click();

    await expect(page.getByText('Delete this contract?')).toBeVisible();
    await page.getByRole('button', { name: /Delete permanently/i }).click();

    // 1. The HTTP call the bug was raised against.
    await expect
      .poll(() => deleteCalls.length, { timeout: 30000, message: 'DELETE /contracts/:id fired' })
      .toBeGreaterThan(0);
    expect(deleteCalls[0].status, `DELETE response body: ${deleteCalls[0].body}`).toBe(200);

    // 2. The exact toast copy from the bug screenshot must NOT appear.
    await expect(page.getByText('Failed to delete contract.')).toHaveCount(0);

    // 3. The contract is actually gone — reopening the detail route shows the
    //    not-found state instead of the contract.
    await page.goto(appUrl(`/contracts/${familyId}`));
    await expect(page.getByText('Contract not found')).toBeVisible({ timeout: 30000 });
  });
});
