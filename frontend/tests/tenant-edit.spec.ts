/**
 * CEIQ-FEAT-001 — UI Tenant Profile & Edit (US-2.3).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMEDIT-001…009.
 *
 * Data is seeded per-test via the admin API (utils/adminApi.ts) and isolated by
 * searching the seeded tenant's unique name — dev is shared and has no delete.
 */
import { test, expect } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { uniqueTenant } from './fixtures/testData';
import { seedSetupTenant, seedHandedOverTenant } from '../utils/adminApi';

test.describe('US-2.3 Tenant Profile & Edit', () => {
  test(
    'TC-ADMEDIT-001 profile shows two independent read-only sections with own Edit buttons',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      const detailRequests = list.trackTenantDetailRequests();
      // Both entry points (card body + card Edit button) open the profile.
      await list.openProfile(t.companyName);
      await profile.expectOpen();
      await profile.closeProfile();
      await list.clickCardEdit(t.companyName);
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

  test(
    'TC-ADMEDIT-002 section edit independence (one section, both sections, cancel one keeps the other)',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
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
      // Company reverts to read-only; PO stays mid-edit with in-progress text.
      await profile.expectCompanySectionReadOnly();
      await profile.expectOwnerSectionEditing();
      await profile.expectOwnerNameValue('Retained Name');
      await profile.cancelOwnerSection();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMEDIT-003 save Company info: applies, returns read-only, never notifies the Owner',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder); // worst case for an accidental Owner notification
      await list.searchTenants(t.companyName);
      const newAddress = '9 Harbour View, Sydney, NSW, Australia';
      const ownerRequests = list.trackOwnerPatchRequests();
      const companyRequests = list.trackCompanyPatchRequests();
      await list.openProfile(t.companyName);
      await profile.editCompanySection();
      await profile.fillCompanyAddress(newAddress);
      await profile.saveCompanySection();
      // Section returns to read-only with a success toast; only PATCH …/company fired.
      await profile.expectCompanySectionReadOnly();
      await profile.expectToastVisible();
      expect(companyRequests.count(), 'company save fires PATCH …/company').toBe(1);
      expect(ownerRequests.count(), 'company save must never notify the Owner (no PATCH …/owner)').toBe(0);
      // New address persisted after reopening.
      await profile.closeProfile();
      await list.openProfile(t.companyName);
      await profile.expectCompanySectionContains(newAddress);
      ownerRequests.stop();
      companyRequests.stop();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMEDIT-004 PO name-only change: in-place update, no email, regardless of status',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const newOwnerName = 'Thomas Whitfield';
      const setup = await seedSetupTenant(seeder);
      const handedOver = await seedHandedOverTenant(seeder);
      const subCases: ReadonlyArray<{ companyName: string; isSetup: boolean }> = [
        { companyName: setup.companyName, isSetup: true },
        { companyName: handedOver.companyName, isSetup: false },
      ];
      for (const subCase of subCases) {
        await list.searchTenants(subCase.companyName);
        await list.openProfile(subCase.companyName);
        // 4a: note the setup password before the edit (must be unchanged).
        const passwordBefore = subCase.isSetup ? await profile.revealAndReadSetupPassword() : null;
        await profile.editOwnerSection();
        await profile.fillOwnerName(newOwnerName);
        await profile.saveOwnerSection();
        // No confirmation dialog for a name-only change; save applies via PATCH …/owner.
        await profile.dialog.expectClosed();
        await profile.expectOwnerSectionReadOnly();
        await profile.expectOwnerName(newOwnerName);
        // (4a) Setup password unchanged — not regenerated. The section re-masks
        // after save, so re-reveal to compare the plaintext value.
        if (passwordBefore !== null) {
          const passwordAfter = await profile.revealAndReadSetupPassword();
          expect(passwordAfter, 'setup password unchanged after a name-only edit').toBe(
            passwordBefore,
          );
        }
        // New name also shown on the card.
        await profile.closeProfile();
        await list.expectCardOwnerName(subCase.companyName, newOwnerName);
      }
    },
  );

  test(
    'TC-ADMEDIT-005 PO email change on Handed-Over tenant: confirmation dialog (exact copy) then reassignment',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      const name = t.companyName;
      const newEmail = `reassigned.${Date.now().toString(36)}@example.com`;
      const ownerRequests = list.trackOwnerPatchRequests();
      // 5b (cancel variant first — non-destructive): edit + Save → dialog → Cancel.
      await list.openProfile(name);
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(newEmail);
      await profile.saveOwnerSection();
      await profile.dialog.expectText(Copy.ownerEmailChangeDialog);
      await profile.dialog.cancel();
      expect(ownerRequests.count(), 'cancel must not fire the reassignment PATCH').toBe(0);
      // 5a (confirm variant): the section stays in edit mode after cancel — re-save
      // (the email is still typed) and confirm → reassignment proceeds.
      await profile.fillOwnerEmail(newEmail);
      await profile.saveOwnerSection();
      await profile.dialog.expectText(Copy.ownerEmailChangeDialog);
      await profile.dialog.confirm();
      await profile.expectOwnerEmail(newEmail);
      expect(ownerRequests.count(), 'confirmed reassignment fires PATCH …/owner').toBe(1);
      ownerRequests.stop();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMEDIT-006 PO email change during Setup: new setup password displayed, no dialog-email flow, no email',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedSetupTenant(seeder);
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
      const ownerRequests = list.trackOwnerPatchRequests();
      // 1. Note the currently displayed setup password.
      const passwordBefore = await profile.revealAndReadSetupPassword();
      // 2. Edit PO email; Save.
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(`newpo.${Date.now().toString(36)}@example.com`);
      await profile.saveOwnerSection();
      // 3. A NEW setup password is displayed (differs from step 1); no dialog-email flow.
      await profile.dialog.expectClosed();
      const passwordAfter = await profile.revealAndReadSetupPassword();
      expect(passwordAfter, 'a new setup password replaces the previous one during Setup').not.toBe(
        passwordBefore,
      );
      expect(ownerRequests.count(), 'a setup PO email change is a single PATCH …/owner').toBe(1);
      ownerRequests.stop();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMEDIT-007 duplicate checks on edit exclude self (domain + email)',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      // Seed tenant A (collision source) and tenant B (the one we edit).
      const a = await seedSetupTenant(seeder, 'EditA');
      const b = await seedHandedOverTenant(seeder, { label: 'EditB' });
      await list.searchTenants(b.companyName);
      // 7a — edit B's URL to A's domain → blocked.
      await list.openProfile(b.companyName);
      await profile.editCompanySection();
      await profile.fillWebsiteUrl(a.websiteUrl);
      await profile.saveCompanySection();
      await profile.expectCompanySectionError(Copy.duplicateDomain);
      await profile.cancelCompanySection();
      // 7b — edit B's owner email to A's owner email → blocked (destructive change
      // on Handed Over prompts the dialog first; server rejects on confirm).
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(a.ownerEmail);
      await profile.saveOwnerSection();
      await profile.dialog.expectText(Copy.ownerEmailChangeDialog);
      await profile.dialog.confirm();
      await profile.expectOwnerSectionError(Copy.duplicateEmail);
      await profile.cancelOwnerSection();
      // 7c — resave B's URL unchanged → succeeds (self excluded).
      await profile.editCompanySection();
      await profile.fillWebsiteUrl(b.websiteUrl);
      await profile.saveCompanySection();
      await profile.expectCompanySectionReadOnly();
      // 7d — resave B's owner email unchanged → succeeds (no dialog, no email).
      await profile.editOwnerSection();
      await profile.fillOwnerEmail(b.ownerEmail);
      await profile.saveOwnerSection();
      await profile.dialog.expectClosed();
      await profile.expectOwnerSectionReadOnly();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMEDIT-008 closing the profile mid-edit discards unsaved changes in both sections',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      const patchRequests = list.trackAnyTenantPatchRequests();
      await list.openProfile(t.companyName);
      // Put both sections in edit mode, type unsaved changes in each.
      await profile.editCompanySection();
      await profile.editOwnerSection();
      await profile.fillCompanyAddress('Discarded address 123');
      await profile.fillOwnerName('Discarded Name');
      // Close the profile, then reopen.
      await profile.closeProfile();
      await list.openProfile(t.companyName);
      // Both sections read-only, showing last-SAVED values — typed changes gone; no PATCH fired.
      await profile.expectCompanySectionReadOnly();
      await profile.expectOwnerSectionReadOnly();
      await profile.expectCompanySectionNotContains('Discarded address 123');
      await profile.expectOwnerSectionNotContains('Discarded Name');
      expect(patchRequests.count(), 'closing mid-edit must not fire a PATCH').toBe(0);
      patchRequests.stop();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMEDIT-009 saving the PO section with nothing changed is a no-op',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
      await profile.editOwnerSection();
      // Save without changing values (retype the identical email).
      await profile.fillOwnerEmail(t.ownerEmail);
      await profile.saveOwnerSection();
      // No confirmation dialog, section returns read-only with unchanged values.
      await profile.dialog.expectClosed();
      await profile.expectOwnerSectionReadOnly();
      await profile.expectOwnerEmail(t.ownerEmail);
      await profile.closeProfile();
    },
  );
});
