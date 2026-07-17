/**
 * Base test — extends @playwright/test with page-object fixtures and an
 * authenticated-session fixture for the CEIQ-FEAT-001 Admin Portal suite.
 */
import { test as base, expect } from '@playwright/test';
import { CreateTenantPage } from '../../pages/CreateTenantPage';
import { LoginPage } from '../../pages/LoginPage';
import { TenantListPage } from '../../pages/TenantListPage';
import { TenantProfilePage } from '../../pages/TenantProfilePage';
import { AdminApiSeeder } from '../../utils/adminApi';
import { hasVar, paEmail, paPassword } from '../../utils/env';

/** Single reason string used by every fixme'd spec in this suite. */
export const FIXME_REASON =
  'CEIQ-FEAT-001 admin portal frontend URL not available as of 2026-07-08';

/** Test-details annotation attached to every fixme'd spec (visible in reports). */
export const FIXME_DETAILS = {
  annotation: { type: 'fixme', description: FIXME_REASON },
} as const;

interface PageFixtures {
  loginPage: LoginPage;
  tenantListPage: TenantListPage;
  createTenantPage: CreateTenantPage;
  tenantProfilePage: TenantProfilePage;
  /**
   * Authenticated Platform Admin session, landed on the Tenant List.
   *
   * storageState constraint (documented per the kit's fixture guidance):
   * SPEC_CEIQ-FEAT-001 §8.2 keeps admin-pool Cognito tokens IN MEMORY in the
   * client-side SDK — there is no cookie / localStorage session for Playwright
   * `storageState` to capture or replay. Every test that needs auth therefore
   * RE-LOGS-IN through the UI via LoginPage. Revisit (switch to a shared
   * storageState setup project) only if the frontend later persists tokens.
   */
  authenticatedTenantList: TenantListPage;
  /**
   * Admin-API seeding harness for controlled tenant data. Reads the logged-in
   * SPA's ID token lazily (on first call), so a test must also use
   * `authenticatedTenantList` (or otherwise log in) before seeding.
   */
  seeder: AdminApiSeeder;
}

export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  tenantListPage: async ({ page }, use) => {
    await use(new TenantListPage(page));
  },
  createTenantPage: async ({ page }, use) => {
    await use(new CreateTenantPage(page));
  },
  tenantProfilePage: async ({ page }, use) => {
    await use(new TenantProfilePage(page));
  },
  authenticatedTenantList: async ({ loginPage, tenantListPage }, use) => {
    // Missing SECRETS skip cleanly with the variable + file named — never a
    // hardcoded fallback (secrets-and-env.rules §3).
    test.skip(
      !hasVar('PA_EMAIL') || !hasVar('PA_PASSWORD'),
      'Set PA_EMAIL and PA_PASSWORD in automation/frontend/.env (see .env.example)',
    );
    await loginPage.goto();
    await loginPage.login(paEmail(), paPassword());
    await tenantListPage.expectLanded();
    await use(tenantListPage);
  },
  seeder: async ({ page, request }, use) => {
    await use(new AdminApiSeeder(page, request));
  },
});

export { expect };
