/**
 * CEIQ-FEAT-001 — UI generic error + loading states (§10).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMUX-001, TC-ADMUX-002.
 *
 * Data is seeded per-test via the admin API (utils/adminApi.ts) and isolated by
 * searching the seeded tenant's unique name — dev is shared and has no delete.
 */
import { test } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { uniqueTenant } from './fixtures/testData';
import { seedHandedOverTenant } from '../utils/adminApi';

test.describe('§10 UX states', () => {
  test(
    'TC-ADMUX-001 unexpected API error shows the generic error toast @smoke @regression',
    async ({ authenticatedTenantList: list, createTenantPage, seeder }) => {
      // 1a — POST /admin/tenants mocked 500: generic toast, no internal detail,
      // triggering button re-enables; retry succeeds after the mock is removed.
      const tenant = uniqueTenant();
      const restoreCreate = await createTenantPage.mockCreateFailure(500);
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      await createTenantPage.expectToast(Copy.genericErrorToast);
      await createTenantPage.expectSubmitEnabled();
      // 3. Remove the mock and retry — succeeds normally.
      await restoreCreate();
      await createTenantPage.submit();
      await list.expectToast(Copy.tenantCreatedToast(tenant.companyName));
      await list.expectLanded();

      // 1b — PATCH …/status mocked network abort: generic toast on a handed-over
      // tenant's toggle; retry succeeds after the mock is removed.
      const ho = await seedHandedOverTenant(seeder);
      await list.searchTenants(ho.companyName);
      const name = ho.companyName;
      const restoreStatus = await list.mockStatusFailure('abort');
      await list.clickCardToggle(name);
      await list.dialog.confirm();
      await list.expectToast(Copy.genericErrorToast);
      await restoreStatus();
      await list.clickCardToggle(name);
      await list.dialog.confirm();
      await list.expectToastVisible();
    },
  );

  test(
    'TC-ADMUX-002 loading states on toggle confirmations and section saves @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      const name = t.companyName;
      const delayMs = 2000;
      // 2a — status-toggle confirm with a ~2 s delayed response: the confirming
      // button shows a loading indicator during the call; dialog closes on success.
      const restoreStatus = await list.delayStatusResponse(delayMs);
      await list.clickCardToggle(name);
      await list.dialog.confirmAndExpectPending();
      await list.dialog.expectClosed();
      await restoreStatus();

      // 2b — Company section Save with a delayed response.
      await list.openProfile(name);
      const restoreCompany = await profile.delayCompanyResponse(delayMs);
      await profile.editCompanySection();
      await profile.fillCompanyAddress('Loading-state address 1');
      await profile.saveCompanySectionExpectingPending();
      await profile.expectCompanySectionReadOnly();
      await restoreCompany();

      // 2c — PO section Save (name-only) with a delayed response.
      const restoreOwner = await profile.delayOwnerResponse(delayMs);
      await profile.editOwnerSection();
      await profile.fillOwnerName('Loading State Owner');
      await profile.saveOwnerSectionExpectingPending();
      await profile.expectOwnerSectionReadOnly();
      await restoreOwner();
      await profile.closeProfile();
    },
  );
});
