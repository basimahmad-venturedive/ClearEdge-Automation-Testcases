/**
 * Auth setup — logs in ONCE per app and saves the session as storageState, so the
 * ~60 per-test logins that throttled a full run collapse to two. Runs as the
 * `setup` project; `admin` and `po` projects depend on it and load the saved state.
 *
 * Both apps persist their session to localStorage (admin: `ce-admin-auth-session`,
 * app: `persist:ceiq-auth`), so storageState round-trips them.
 */
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { AppLoginPage } from '../pages/AppLoginPage';
import {
  hasVar, paEmail, paPassword, pmEmail, pmPassword, analystEmail, analystPassword,
} from '../utils/env';

export const ADMIN_STORAGE = 'playwright/.auth/admin.json';
export const PO_STORAGE = 'playwright/.auth/po.json';
export const PM_STORAGE = 'playwright/.auth/pm.json';
export const ANALYST_STORAGE = 'playwright/.auth/analyst.json';

setup('authenticate Platform Admin (admin portal)', async ({ page }) => {
  setup.skip(
    !hasVar('PA_EMAIL') || !hasVar('PA_PASSWORD'),
    'Set PA_EMAIL and PA_PASSWORD in automation/frontend/.env.dev',
  );
  const login = new LoginPage(page);
  await login.goto();
  await login.login(paEmail(), paPassword());
  await page.waitForURL(/\/tenants/, { timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Create Tenant' }).first()).toBeVisible();
  await page.context().storageState({ path: ADMIN_STORAGE });
});

setup('authenticate Procurement Owner (main app)', async ({ page }) => {
  setup.skip(
    !hasVar('PO_EMAIL') || !hasVar('PO_PASSWORD'),
    'Set PO_EMAIL and PO_PASSWORD in automation/frontend/.env.dev',
  );
  await new AppLoginPage(page).loginAsPO();
  await page.context().storageState({ path: PO_STORAGE });
});

setup('authenticate Procurement Manager (main app)', async ({ page }) => {
  setup.skip(
    !hasVar('PM_EMAIL') || !hasVar('PM_PASSWORD'),
    'Set PM_EMAIL and PM_PASSWORD in automation/frontend/.env.<env>',
  );
  await new AppLoginPage(page).login(pmEmail(), pmPassword());
  await page.context().storageState({ path: PM_STORAGE });
});

setup('authenticate Procurement Analyst (main app)', async ({ page }) => {
  setup.skip(
    !hasVar('ANALYST_EMAIL') || !hasVar('ANALYST_PASSWORD'),
    'Set ANALYST_EMAIL and ANALYST_PASSWORD in automation/frontend/.env.<env>',
  );
  await new AppLoginPage(page).login(analystEmail(), analystPassword());
  await page.context().storageState({ path: ANALYST_STORAGE });
});
