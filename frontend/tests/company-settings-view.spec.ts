/**
 * CEIQ-FEAT-004 — Company Settings view (US-CS-002, §5.2).
 * Source: testcases/TC-CEIQ-FEAT-004.md — TC-CSVIEW-001…006.
 *
 * SCAFFOLDED with test.skip: screen not built, no env / PO session (§9 TBD).
 * TODO_FIXTURE: PO-authenticated session + seeded / new-tenant content states.
 */
import { test, expect } from '@playwright/test';
import { CompanySettingsPage } from '../pages/CompanySettingsPage';
import { CsCopy } from './fixtures/expectedCopyCompanySettings';

test.describe('US-CS-002 View Company Settings sections', () => {
  test.skip('TC-CSVIEW-001 three sections render with exact "Company …" headings @smoke', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await expect(page.getByRole('heading', { name: CsCopy.sectionDisplayName.background })).toBeVisible();
    await expect(page.getByRole('heading', { name: CsCopy.sectionDisplayName.introduction })).toBeVisible();
    await expect(page.getByRole('heading', { name: CsCopy.sectionDisplayName.terms_and_conditions })).toBeVisible();
  });

  test.skip('TC-CSVIEW-002 all sections read-only by default; Edit enabled, Save disabled, no Discard', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.expectReadOnly('background');
    await cs.expectReadOnly('introduction');
    await cs.expectReadOnly('terms_and_conditions');
  });

  test.skip('TC-CSVIEW-003 page heading is exactly "Company Settings" with subtitle', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await expect(page.getByRole('heading', { name: CsCopy.pageHeading, exact: true })).toBeVisible();
    await expect(page.getByText(CsCopy.subtitle)).toBeVisible();
  });

  test.skip('TC-CSVIEW-004 new/unsaved tenant shows blank fields (no placeholder/template text)', async ({ page }) => {
    // TODO_FIXTURE: brand-new tenant with zero company_settings rows (GET all-null).
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await expect(cs.contentReadonly('background')).toHaveText('');
    await expect(cs.contentReadonly('introduction')).toHaveText('');
    await expect(cs.contentReadonly('terms_and_conditions')).toHaveText('');
  });

  test.skip('TC-CSVIEW-005 all section text is standard black (no gray/muted styling)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    const color = await cs.contentReadonly('background').evaluate((el) => getComputedStyle(el).color);
    expect(['rgb(0, 0, 0)']).toContain(color); // adjust to the design's black token when known
  });

  test.skip('TC-CSVIEW-006 page load fires GET /company-settings with a loading indicator', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/company-settings') && r.request().method() === 'GET'),
      cs.goto(),
    ]);
    expect(resp.status()).toBe(200);
  });
});
