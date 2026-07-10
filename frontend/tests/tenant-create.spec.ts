/**
 * CEIQ-FEAT-001 — UI Create Tenant (US-3.1).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMCREATE-001…007
 * (UI-AUTOMATION cases; the API-only TC-ADMCREATE-008 is out of scope here).
 *
 * Every test is test.fixme(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 */
import { test, expect, FIXME_DETAILS } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { SETUP_TENANT, uniqueTenant, valueOfLength } from './fixtures/testData';
import type { CreateField } from '../locators/createTenant';

test.describe('US-3.1 Create Tenant', () => {
  test.fixme(
    'TC-ADMCREATE-001 happy path: create tenant + PO, land on page 1 with toast',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): domain + owner email unused by any tenant/user.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      // Redirect to the Tenant List page 1, new tenant at the top; exact toast
      // "[Company Name] (TEN####) was created." with the generated Tenant ID.
      await list.expectLanded();
      await list.expectToast(Copy.tenantCreatedToast(tenant.companyName));
      await list.expectFirstCard(tenant.companyName);
      // New tenant's card: badge "Setup"; toggle disabled with label "Inactive".
      await list.expectCardBadge(tenant.companyName, 'Setup');
      await list.expectCardToggleDisabled(tenant.companyName);
      await list.expectCardStatusLabel(tenant.companyName, 'Inactive');
      // Profile shows the setup password (per TC-ADMSETUP-001).
      await list.openProfile(tenant.companyName);
      await profile.expectSetupPasswordVisible();
      // No-invite-email side condition is asserted at the API/DB layer
      // (TC-ADMAPI-010), not the UI (see TC file Gaps).
      // Cleanup (TODO_FIXTURE): deactivate/namespace the created tenant.
    },
  );

  test.fixme(
    'TC-ADMCREATE-002 per-field validation messages (blur + submit; first invalid field scrolled into view)',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      const createRequests = createTenantPage.trackCreateRequests();
      await list.openCreateTenant();
      await createTenantPage.expectFormVisible();
      // Per-field on blur: exact §5 copy per sub-case (parameterized 2a–2f).
      const subCases: ReadonlyArray<{ subId: string; field: CreateField; input: string; error: string }> = [
        { subId: '2a', field: 'companyName', input: '', error: Copy.companyNameRequired },
        { subId: '2b', field: 'websiteUrl', input: '', error: Copy.websiteUrlInvalid },
        { subId: '2c', field: 'websiteUrl', input: 'not a url ::', error: Copy.websiteUrlInvalid },
        { subId: '2d', field: 'companyAddress', input: '', error: Copy.companyAddressRequired },
        { subId: '2e', field: 'ownerName', input: '', error: Copy.ownerNameRequired },
        { subId: '2f', field: 'ownerEmail', input: 'bad-email', error: Copy.invalidEmail },
      ];
      for (const subCase of subCases) {
        await createTenantPage.fillField(subCase.field, subCase.input);
        await createTenantPage.blurField(subCase.field);
        await createTenantPage.expectFieldError(subCase.field, subCase.error);
      }
      // Full submit with ALL fields invalid: submission blocked; the FIRST
      // invalid field (Company Name) is scrolled into view.
      await createTenantPage.submit();
      await createTenantPage.expectFieldError('companyName', Copy.companyNameRequired);
      await createTenantPage.expectFieldInViewport('companyName');
      // No POST /admin/tenants fires while blocked.
      expect(createRequests.count(), 'no create call may fire while validation blocks submit').toBe(0);
      createRequests.stop();
    },
  );

  test.fixme(
    'TC-ADMCREATE-003 field max-length boundaries (255 / 255 / 500 / 255 / 320)',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      await list.openCreateTenant();
      await createTenantPage.expectFormVisible();
      // At-limit accepted (no error); one char over → exact §5 max-length copy
      // (parameterized 3a–3e).
      const subCases: ReadonlyArray<{ subId: string; field: CreateField; limit: number; overError: string }> = [
        { subId: '3a', field: 'companyName', limit: 255, overError: Copy.companyNameMaxLength },
        { subId: '3b', field: 'websiteUrl', limit: 255, overError: Copy.websiteUrlMaxLength },
        { subId: '3c', field: 'companyAddress', limit: 500, overError: Copy.companyAddressMaxLength },
        { subId: '3d', field: 'ownerName', limit: 255, overError: Copy.ownerNameMaxLength },
        { subId: '3e', field: 'ownerEmail', limit: 320, overError: Copy.ownerEmailMaxLength },
      ];
      for (const subCase of subCases) {
        // At the limit: accepted.
        await createTenantPage.fillField(subCase.field, valueOfLength(subCase.field, subCase.limit));
        await createTenantPage.blurField(subCase.field);
        await createTenantPage.expectNoFieldError(subCase.field);
        // One char over the limit: exact over-limit message.
        await createTenantPage.fillField(subCase.field, valueOfLength(subCase.field, subCase.limit + 1));
        await createTenantPage.blurField(subCase.field);
        await createTenantPage.expectFieldError(subCase.field, subCase.overError);
      }
    },
  );

  test.fixme(
    'TC-ADMCREATE-004 duplicate domain and duplicate email are blocked with exact messages',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      // Precondition (TODO_FIXTURE): existing SETUP_TENANT (Acme Logistics /
      // acmelogistics.com / sarah.chen@acmelogistics.com).
      // 4a — duplicate website domain is blocked.
      await list.openCreateTenant();
      await createTenantPage.fillForm(
        uniqueTenant({ websiteUrl: SETUP_TENANT.websiteUrl }),
      );
      await createTenantPage.submit();
      await createTenantPage.expectFieldError('websiteUrl', Copy.duplicateDomain);
      // 4b — duplicate owner email is blocked.
      await createTenantPage.fillForm(
        uniqueTenant({ ownerEmail: SETUP_TENANT.ownerEmail }),
      );
      await createTenantPage.submit();
      await createTenantPage.expectFieldError('ownerEmail', Copy.duplicateEmail);
      // 4c — duplicate COMPANY NAME with a unique domain/email succeeds
      // (company-name uniqueness is not enforced).
      const duplicateNameTenant = uniqueTenant({ companyName: SETUP_TENANT.companyName });
      await createTenantPage.fillForm(duplicateNameTenant);
      await createTenantPage.submit();
      await list.expectLanded();
      await list.expectToast(Copy.tenantCreatedToast(duplicateNameTenant.companyName));
      // Cleanup (TODO_FIXTURE): teardown the 4c tenant.
    },
  );

  test.fixme(
    'TC-ADMCREATE-005 domain normalization: protocol / www. / path variants collide',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      // Precondition (TODO_FIXTURE): existing tenant with stored domain
      // acmelogistics.com. Every variant normalizes to the same bare domain,
      // which is taken → duplicate-domain error (parameterized 5a–5d).
      const base = SETUP_TENANT.websiteUrl; // acmelogistics.com
      const subCases: ReadonlyArray<{ subId: string; input: string }> = [
        { subId: '5a', input: `https://www.${base}` },
        { subId: '5b', input: `www.${base}` },
        { subId: '5c', input: `${base}/about` },
        { subId: '5d', input: `${base}:8080` },
      ];
      for (const subCase of subCases) {
        await list.openCreateTenant();
        await createTenantPage.fillForm(uniqueTenant({ websiteUrl: subCase.input }));
        await createTenantPage.submit();
        await createTenantPage.expectFieldError('websiteUrl', Copy.duplicateDomain);
      }
      // The stored-value assertion (tenants.domain = 'acmelogistics.com')
      // belongs to TC-ADMAPI-011 (API + DB), not this UI case.
    },
  );

  test.fixme(
    'TC-ADMCREATE-006 double-click submit creates exactly one tenant; button disables with loading state',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      // Precondition (TODO_FIXTURE): valid, unique form data.
      const tenant = uniqueTenant();
      const createRequests = createTenantPage.trackCreateRequests();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      // Double-click Submit rapidly: only ONE POST fires; button disabled +
      // loading indicator during the call (double-click prevention, §8.4/§10).
      await createTenantPage.doubleClickSubmit();
      await createTenantPage.expectSubmitDisabledWithLoading();
      await list.expectLanded();
      expect(createRequests.count(), 'double-click must fire exactly one create call').toBe(1);
      createRequests.stop();
      // Exactly one tenant exists with that domain (verify via search).
      await list.searchTenants(tenant.companyName);
      await list.expectCardCount(1);
      await list.clearSearch();
      // Cleanup (TODO_FIXTURE): teardown the created tenant.
    },
  );

  test.fixme(
    'TC-ADMCREATE-007 cancel returns to the Tenant List without saving',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      // Precondition: create form open with all fields filled (unique values).
      const tenant = uniqueTenant();
      const createRequests = createTenantPage.trackCreateRequests();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.cancel();
      // Back on the Tenant List; nothing created; no POST fired.
      await list.expectLanded();
      await list.searchTenants(tenant.companyName);
      await list.expectCardCount(0);
      await list.expectNoMatchMessage(tenant.companyName);
      await list.clearSearch();
      expect(createRequests.count(), 'cancel must not fire a create call').toBe(0);
      createRequests.stop();
    },
  );
});
