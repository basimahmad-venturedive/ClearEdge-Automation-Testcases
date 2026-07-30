/**
 * CEIQ-FEAT-004 — Company Settings access control (US-CS-001, §5.1).
 * Source: testcases/TC-CEIQ-FEAT-004.md — TC-CSACCESS-001…003.
 *
 * Screen shipped on dev (PR #26); runs under the `po` project (PO storageState).
 * The non-Owner cases stay skipped until Manager / Analyst sessions exist.
 */
import { test, expect } from '@playwright/test';
import { CompanySettingsPage } from '../pages/CompanySettingsPage';

test.describe('US-CS-001 Company Settings access (Owner-only)', () => {
  test('TC-CSACCESS-001 Owner sees "Company Settings" in the dropdown and it opens the screen @smoke @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.ensureInApp();
    await cs.openAccountMenu();
    await expect(cs.menuItem).toBeVisible();
    await cs.menuItem.click();
    await expect(page).toHaveURL(/\/company-settings$/);
    await expect(page.getByRole('heading', { name: 'Company Settings', exact: true })).toBeVisible();
  });

  test.skip('TC-CSACCESS-002 Manager/Analyst never see "Company Settings" (absent, not disabled)', async ({
    page,
  }) => {
    // NOT a development gap — the app already hides the item unless the user holds
    // `manage_company_settings`. Blocked only on TEST DATA: we have no Manager /
    // Analyst login (only PO_EMAIL is in .env.dev). Un-skip once a non-Owner
    // account + storageState is provisioned (create via UM, set password, add a
    // `manager`/`analyst` setup + project).
    const cs = new CompanySettingsPage(page);
    await cs.ensureInApp();
    await cs.openAccountMenu();
    await expect(cs.menuItem).toHaveCount(0);
  });

  test.skip('TC-CSACCESS-003 Non-Owner direct URL access is redirected (no access-denied page)', async ({
    page,
  }) => {
    // NOT a development gap — the route guard (useRightGuard) already redirects a
    // non-Owner silently (no 403 page). Blocked only on TEST DATA: needs a
    // non-Owner login, same as TC-CSACCESS-002.
    await page.goto('/company-settings');
    await expect(page).not.toHaveURL(/\/company-settings$/);
    await expect(page.getByText(/access denied|forbidden|403/i)).toHaveCount(0);
  });
});
