/**
 * CEIQ-FEAT-001 — UI Create Tenant (US-3.1).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMCREATE-001…007
 * (UI-AUTOMATION cases; the API-only TC-ADMCREATE-008 is out of scope here).
 *
 * Every test is test(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 */
import { test, expect } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { uniqueTenant, valueOfLength } from './fixtures/testData';
import { uniquePrefix } from '../utils/adminApi';
import type { CreateField } from '../locators/createTenant';

test.describe('US-3.1 Create Tenant', () => {
  test(
    'TC-ADMCREATE-001 happy path: create tenant + PO, land on page 1 with toast @smoke @regression',
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): domain + owner email unused by any tenant/user.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      // Exact success toast "[Company Name] (TEN####) was created." — asserted
      // FIRST because the antd message auto-dismisses (~2.5s) and the shared-dev
      // list can take longer than that to finish loading.
      await list.expectToast(Copy.tenantCreatedToast(tenant.companyName));
      // Redirect to the Tenant List page 1, new tenant at the top.
      await list.expectLanded();
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

  test(
    'TC-ADMCREATE-002 per-field validation messages (blur + submit; first invalid field scrolled into view) @smoke @regression',
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
        // The app validates on change (antd default), so an untouched field left
        // empty never fires. Prime with a throwaway value first, so setting the
        // sub-case input (often empty) registers as a change and validates.
        await createTenantPage.fillField(subCase.field, 'prime');
        await createTenantPage.fillField(subCase.field, subCase.input);
        await createTenantPage.blurField(subCase.field);
        await createTenantPage.expectFieldError(subCase.field, subCase.error);
      }
      // With all fields invalid the Create Tenant submit is DISABLED (the app now
      // guards submission until the form is valid — fix/clre-53-54), so submission
      // is blocked and no POST fires. (The first-invalid-field scroll only applies
      // to an enabled submit, which isn't reachable while the button is disabled.)
      await expect(
        createTenantPage.submitButton,
        'submit disabled while the form is invalid',
      ).toBeDisabled();
      await createTenantPage.expectFieldError('companyName', Copy.companyNameRequired);
      expect(createRequests.count(), 'no create call may fire while validation blocks submit').toBe(0);
      createRequests.stop();
    },
  );

  test(
    'TC-ADMCREATE-003 field max-length boundaries (255 / 255 / 500 / 255 / 320) @regression',
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      await list.openCreateTenant();
      await createTenantPage.expectFormVisible();
      // At-limit accepted (no error); one char over → exact §5 max-length copy
      // (parameterized 3a–3e).
      const subCases: ReadonlyArray<{ subId: string; field: CreateField; limit: number; overError: string }> = [
        { subId: '3a', field: 'companyName', limit: 255, overError: Copy.companyNameMaxLength },
        { subId: '3b', field: 'websiteUrl', limit: 500, overError: Copy.websiteUrlMaxLength },
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

  test(
    'TC-ADMCREATE-004 duplicate domain and duplicate email are blocked with exact messages @regression',
    async ({ authenticatedTenantList: list, createTenantPage, seeder }) => {
      // Seed a base tenant to collide against (self-contained on shared dev).
      const tag = uniquePrefix('Dup');
      const base = await seeder.createTenant({
        name: `${tag} Base Co`,
        websiteUrl: `${tag.toLowerCase()}.example.com`,
        address: '1 Base Street, Test City',
        ownerName: 'Base Owner',
        ownerEmail: `base.${tag.toLowerCase()}@example.com`,
      });
      // 4a — duplicate website domain is blocked (form stays open on error).
      await list.openCreateTenant();
      await createTenantPage.fillForm(uniqueTenant({ websiteUrl: base.websiteUrl }));
      await createTenantPage.submit();
      await createTenantPage.expectFieldError('websiteUrl', Copy.duplicateDomain);
      // 4b — duplicate owner email is blocked.
      await createTenantPage.fillForm(uniqueTenant({ ownerEmail: base.ownerEmail }));
      await createTenantPage.submit();
      await createTenantPage.expectFieldError('ownerEmail', Copy.duplicateEmail);
      // 4c — duplicate COMPANY NAME with a unique domain/email succeeds
      // (company-name uniqueness is not enforced).
      const duplicateNameTenant = uniqueTenant({ companyName: base.name });
      await createTenantPage.fillForm(duplicateNameTenant);
      await createTenantPage.submit();
      await list.expectToast(Copy.tenantCreatedToast(duplicateNameTenant.companyName));
      await list.expectLanded();
    },
  );

  test(
    'TC-ADMCREATE-005 domain normalization: protocol / www. / path variants collide @regression',
    async ({ authenticatedTenantList: list, createTenantPage, seeder }) => {
      // Seed a base tenant; every variant normalizes to its bare domain, which
      // is now taken → duplicate-domain error (parameterized 5a–5d).
      const tag = uniquePrefix('Norm');
      const base = await seeder.createTenant({
        name: `${tag} Base Co`,
        websiteUrl: `${tag.toLowerCase()}.example.com`,
        address: '1 Norm Street, Test City',
        ownerName: 'Norm Owner',
        ownerEmail: `norm.${tag.toLowerCase()}@example.com`,
      });
      const domain = base.websiteUrl; // <tag>.example.com
      const variants: ReadonlyArray<{ input: string; error: string }> = [
        { input: `https://www.${domain}`, error: Copy.duplicateDomain },
        { input: `www.${domain}`, error: Copy.duplicateDomain },
        { input: `${domain}/about`, error: Copy.duplicateDomain },
        // A :port is rejected by the client URL format pre-check (WEBSITE_URL_REGEX
        // allows a /path but not a :port) before the duplicate check runs — actual
        // app behavior; the BE-side normalization of ports is covered by TC-ADMAPI-011.
        { input: `${domain}:8080`, error: Copy.websiteUrlInvalid },
      ];
      // Open the form once — an error keeps it open, so re-fill and re-submit in
      // place (do NOT navigate back to the list each time).
      await list.openCreateTenant();
      for (const variant of variants) {
        await createTenantPage.fillForm(uniqueTenant({ websiteUrl: variant.input }));
        await createTenantPage.submit();
        await createTenantPage.expectFieldError('websiteUrl', variant.error);
      }
      // The stored-value assertion (tenants.domain normalized) belongs to
      // TC-ADMAPI-011 (API + DB), not this UI case.
    },
  );

  test(
    'TC-ADMCREATE-006 double-click submit creates exactly one tenant; button disables with loading state @regression',
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

  test(
    'TC-ADMCREATE-007 cancel returns to the Tenant List without saving @regression',
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
