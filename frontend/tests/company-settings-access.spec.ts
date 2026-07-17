/**
 * CEIQ-FEAT-004 — Company Settings access control (US-CS-001, §5.1).
 * Source: testcases/TC-CEIQ-FEAT-004.md — TC-CSACCESS-001…003.
 *
 * SCAFFOLDED with test.skip: the tenant Company Settings screen is not built and
 * no env / APP_BASE_URL / role-specific sessions exist yet (§9 TBD). Bodies use the
 * proposed selector contract + verbatim copy and run the day the screen + env exist.
 * TODO_FIXTURE: wire Owner / Manager / Analyst authenticated sessions (automation/api-ts tokens).
 */
import { test, expect } from '@playwright/test';
import { CompanySettingsPage } from '../pages/CompanySettingsPage';

test.describe('US-CS-001 Company Settings access (Owner-only)', () => {
  test.skip('TC-CSACCESS-001 Owner sees "Company Settings" in the dropdown and it opens the screen @smoke', async ({ page }) => {
    // TODO_FIXTURE: authenticated as a Procurement Owner.
    const cs = new CompanySettingsPage(page);
    await cs.openAccountMenu();
    await expect(cs.menuItem).toBeVisible();
    await cs.menuItem.click();
    await expect(page).toHaveURL(/\/company-settings$/);
    await expect(page.getByRole('heading', { name: 'Company Settings', exact: true })).toBeVisible();
  });

  test.skip('TC-CSACCESS-002 Manager/Analyst never see "Company Settings" (absent, not disabled)', async ({ page }) => {
    // TODO_FIXTURE: authenticated as a non-Owner (parameterize Manager / Analyst).
    const cs = new CompanySettingsPage(page);
    await cs.openAccountMenu();
    await expect(cs.menuItem).toHaveCount(0); // absent from the DOM, not merely hidden/disabled
  });

  test.skip('TC-CSACCESS-003 Non-Owner direct URL access is silently redirected (no access-denied page)', async ({ page }) => {
    // TODO_FIXTURE: non-Owner session with a known prior screen in history.
    await page.goto('/company-settings');
    await expect(page).not.toHaveURL(/\/company-settings$/); // returned to prior screen / home
    await expect(page.getByText(/access denied|forbidden|403/i)).toHaveCount(0); // no error page
  });
});
