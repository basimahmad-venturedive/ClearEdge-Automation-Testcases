/**
 * CEIQ-FEAT-001 — UI Tenant Profile & Edit (US-2.3).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMEDIT-001…009.
 *
 * Every test is test.fixme(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 */
import { test, expect, FIXME_DETAILS } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { SETUP_TENANT, HANDED_OVER_TENANT, uniqueTenant } from './fixtures/testData';

test.describe('US-2.3 Tenant Profile & Edit', () => {
  test.fixme(
    'TC-ADMEDIT-001 profile shows two independent read-only sections with own Edit buttons',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): tenant exists (either status).
      const detailRequests = list.trackTenantDetailRequests();
      // Both entry points (card body + card Edit button) open the profile.
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      await profile.expectOpen();
      await profile.closeProfile();
      await list.clickCardEdit(HANDED_OVER_TENANT.companyName);
      await profile.expectOpen();
      // Company + PO sections both read-only, each with its own Edit button;
      // a GET /admin/tenants/:id request loaded the data (§8.5).
      await profile.expectCompanySectionReadOnly();
      await profile.expectOwnerSectionReadOnly();
      expect(detailRequests.count(), 'opening the profile loads detail via GET /tenants/:id').toBeGreaterThan(0);
      detailRequests.stop();
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-002 section edit independence (one section, both sections, cancel one keeps the other)',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): tenant profile open.
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      // 2a — edit Company only: only that section becomes editable.
      await profile.editCompanySection();
      await profile.expectCompanySectionEditing();
      await profile.expectOwnerSectionReadOnly();
      await profile.cancelCompanySection();
      // 2b — edit PO only: only that section becomes editable.
      await profile.editOwnerSection();
      await profile.expectOwnerSectionEditing();
      await profile.expectCompanySectionReadOnly();
      await profile.cancelOwnerSection();
      // 2c — edit both, cancel Company; PO retains its typed changes.
      await profile.editCompanySection();
      await profile.editOwnerSection();
      await profile.fillCompanyAddress('Mid-edit address 999');
      await profile.fillOwnerName('Retained Name');
      await profile.cancelCompanySection();
      // Company reverts to read-only (last-saved values); PO stays mid-edit
      // with the in-progress text intact.
      await profile.expectCompanySectionReadOnly();
      await profile.expectOwnerSectionEditing();
      await profile.expectOwnerNameValue('Retained Name');
      // Cleanup: cancel the remaining edit.
      await profile.cancelOwnerSection();
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-003 save Company info: applies, returns read-only, never notifies the Owner',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): Handed-Over tenant (worst case for an
      // accidental Owner notification).
      const newAddress = '9 Harbour View, Sydney, NSW, Australia';
      const ownerRequests = list.trackOwnerPatchRequests();
      const companyRequests = list.trackCompanyPatchRequests();
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      await profile.editCompanySection();
      await profile.fillCompanyAddress(newAddress);
      await profile.saveCompanySection();
      // Section returns to read-only with a success confirmation (exact copy
      // unspecified — TC Gap #6 — assert presence only); only PATCH …/company fired.
      await profile.expectCompanySectionReadOnly();
      await profile.expectToastVisible();
      expect(companyRequests.count(), 'company save fires PATCH …/company').toBe(1);
      expect(ownerRequests.count(), 'company save must never notify the Owner (no PATCH …/owner)').toBe(0);
      // New address persisted after reopening.
      await profile.closeProfile();
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      await profile.expectCompanySectionContains(newAddress);
      // No email dispatched — asserted at the API/mail layer (TC file Gaps).
      ownerRequests.stop();
      companyRequests.stop();
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-004 PO name-only change: in-place update, no email, regardless of status',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): 4a Setup tenant · 4b Handed-Over tenant.
      const newOwnerName = 'Thomas Whitfield';
      const subCases: ReadonlyArray<{ subId: string; companyName: string }> = [
        { subId: '4a', companyName: SETUP_TENANT.companyName },
        { subId: '4b', companyName: HANDED_OVER_TENANT.companyName },
      ];
      for (const subCase of subCases) {
        await list.openProfile(subCase.companyName);
        // 4a: note the setup password before the edit (must be unchanged).
        const passwordBefore =
          subCase.subId === '4a' ? await profile.revealAndReadSetupPassword() : null;
        await profile.editOwnerSection();
        await profile.fillOwnerName(newOwnerName);
        await profile.saveOwnerSection();
        // No confirmation dialog (dialog is only for an email change on Handed
        // Over); save applies via PATCH …/owner.
        await profile.dialog.expectClosed();
        await profile.expectOwnerSectionReadOnly();
        await profile.expectOwnerName(newOwnerName);
        // (4a) Setup password display unchanged — not regenerated.
        if (passwordBefore !== null) {
          await profile.expectSetupPasswordText(passwordBefore);
        }
        // New name also shown on the card.
        await profile.closeProfile();
        await list.expectCardOwnerName(subCase.companyName, newOwnerName);
        // Cleanup (TODO_FIXTURE): restore the original owner name.
      }
    },
  );

  test.fixme(
    'TC-ADMEDIT-005 PO email change on Handed-Over tenant: confirmation dialog (exact copy) then reassignment',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): disposable Handed-Over tenant with PO
      // tom@orbitmediagroup.com (reassignment is destructive to the old PO).
      const name = HANDED_OVER_TENANT.companyName;
      const newEmail = 'tom.new@orbitmediagroup.com';
      const ownerRequests = list.trackOwnerPatchRequests();
      // 5b (cancel variant first — non-destructive): edit + Save → dialog → Cancel.
      await list.openProfile(name);
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(newEmail);
      await profile.saveOwnerSection();
      // Exact confirmation dialog copy.
      await profile.dialog.expectText(Copy.ownerEmailChangeDialog);
      await profile.dialog.cancel();
      // Cancel: no changes applied, no reassignment fired.
      expect(ownerRequests.count(), 'cancel must not fire the reassignment PATCH').toBe(0);
      // 5a (confirm variant): repeat and confirm → reassignment proceeds.
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(newEmail);
      await profile.saveOwnerSection();
      await profile.dialog.expectText(Copy.ownerEmailChangeDialog);
      await profile.dialog.confirm();
      // Profile shows the new email.
      await profile.expectOwnerEmail(newEmail);
      expect(ownerRequests.count(), 'confirmed reassignment fires PATCH …/owner').toBe(1);
      ownerRequests.stop();
      // Invite-email receipt + old-PO lockout are asserted at the API layer
      // (TC-ADMAPI-051 / TC-ADMMAIL-002). Fixture is disposable.
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-006 PO email change during Setup: new setup password displayed, no dialog-email flow, no email',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Setup tenant with a resettable setup password → create a DISPOSABLE one.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      await list.expectLanded();
      await list.openProfile(tenant.companyName);
      const ownerRequests = list.trackOwnerPatchRequests();
      // 1. Note the currently displayed setup password.
      const passwordBefore = await profile.revealAndReadSetupPassword();
      // 2. Edit PO email; Save.
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(uniqueTenant().ownerEmail);
      await profile.saveOwnerSection();
      // 3. A NEW setup password is displayed (differs from step 1); no invite
      // email sent (Handed-Over-style email flow does not apply during Setup).
      const passwordAfter = await profile.revealAndReadSetupPassword();
      expect(passwordAfter, 'a new setup password replaces the previous one during Setup').not.toBe(
        passwordBefore,
      );
      expect(ownerRequests.count(), 'a setup PO email change is a single PATCH …/owner').toBe(1);
      ownerRequests.stop();
      // Old-password invalidation + DB re-encryption asserted in TC-ADMAPI-052.
      // Fixture is disposable.
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-007 duplicate checks on edit exclude self (domain + email)',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): tenant A (acmelogistics.com,
      // sarah.chen@acmelogistics.com) and tenant B (orbitmediagroup.com,
      // tom@orbitmediagroup.com). We edit tenant B (SETUP-style handed over).
      const b = HANDED_OVER_TENANT;
      // 7a — edit B's URL to A's domain → blocked.
      await list.openProfile(b.companyName);
      await profile.editCompanySection();
      await profile.fillWebsiteUrl(SETUP_TENANT.websiteUrl);
      await profile.saveCompanySection();
      await profile.expectCompanySectionError(Copy.duplicateDomain);
      await profile.cancelCompanySection();
      // 7b — edit B's owner email to A's owner email → blocked.
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(SETUP_TENANT.ownerEmail);
      await profile.saveOwnerSection();
      // A destructive email change on Handed Over prompts the dialog first;
      // the server rejects the duplicate on confirm.
      await profile.dialog.expectText(Copy.ownerEmailChangeDialog);
      await profile.dialog.confirm();
      await profile.expectOwnerSectionError(Copy.duplicateEmail);
      await profile.cancelOwnerSection();
      // 7c — resave B's URL unchanged → succeeds (self excluded).
      await profile.editCompanySection();
      await profile.fillWebsiteUrl(b.websiteUrl);
      await profile.saveCompanySection();
      await profile.expectCompanySectionReadOnly();
      // 7d — resave B's owner email unchanged → succeeds (no-op branch,
      // TC-ADMAPI-053: no dialog, no email).
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(b.ownerEmail);
      await profile.saveOwnerSection();
      await profile.dialog.expectClosed();
      await profile.expectOwnerSectionReadOnly();
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-008 closing the profile mid-edit discards unsaved changes in both sections',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): tenant profile open.
      const patchRequests = list.trackAnyTenantPatchRequests();
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      // Put both sections in edit mode, type unsaved changes in each.
      await profile.editCompanySection();
      await profile.editOwnerSection();
      await profile.fillCompanyAddress('Discarded address 123');
      await profile.fillOwnerName('Discarded Name');
      // Close the profile, then reopen.
      await profile.closeProfile();
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      // Both sections read-only, showing last-SAVED values — typed changes gone;
      // no PATCH requests fired. (Unsaved-changes warning on close is
      // unspecified — TC Gap #8 — asserted only via the discard.)
      await profile.expectCompanySectionReadOnly();
      await profile.expectOwnerSectionReadOnly();
      await profile.expectCompanySectionNotContains('Discarded address 123');
      await profile.expectOwnerSectionNotContains('Discarded Name');
      expect(patchRequests.count(), 'closing mid-edit must not fire a PATCH').toBe(0);
      patchRequests.stop();
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMEDIT-009 saving the PO section with nothing changed is a no-op',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): Handed-Over tenant profile open.
      const name = HANDED_OVER_TENANT.companyName;
      await list.openProfile(name);
      await profile.editOwnerSection();
      // Save without changing values (retype the identical email).
      await profile.fillOwnerEmail(HANDED_OVER_TENANT.ownerEmail);
      await profile.saveOwnerSection();
      // No confirmation dialog, no invite email, section returns read-only with
      // unchanged values (server no-op branch — TC-ADMAPI-053).
      await profile.dialog.expectClosed();
      await profile.expectOwnerSectionReadOnly();
      await profile.expectOwnerEmail(HANDED_OVER_TENANT.ownerEmail);
      await profile.closeProfile();
    },
  );
});
