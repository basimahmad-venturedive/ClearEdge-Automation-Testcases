/**
 * CEIQ-FEAT-001 — UI Active/Inactive Toggle (US-2.2).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMTOGGLE-001…007.
 *
 * Data is seeded per-test via the admin API (utils/adminApi.ts) and isolated by
 * searching the seeded tenant's unique name — dev is shared and has no delete.
 */
import { test, expect } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { uniqueTenant } from './fixtures/testData';
import { seedSetupTenant, seedHandedOverTenant } from '../utils/adminApi';

test.describe('US-2.2 Active/Inactive Toggle', () => {
  test(
    'TC-ADMTOGGLE-001 toggle locked to Inactive while tenant is in Setup (card + profile)',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedSetupTenant(seeder);
      await list.searchTenants(t.companyName);
      const statusRequests = list.trackStatusPatchRequests();
      // Card: toggle disabled, label "Inactive"; clicking changes nothing.
      await list.expectCardToggleDisabled(t.companyName);
      await list.expectCardStatusLabel(t.companyName, 'Inactive');
      await list.clickCardToggle(t.companyName, { force: true }); // deliberate attempt on a disabled control
      await list.dialog.expectClosed();
      await list.expectCardStatusLabel(t.companyName, 'Inactive');
      // Profile: same lock.
      await list.openProfile(t.companyName);
      await profile.expectToggleDisabled();
      await profile.expectStatusLabel('Inactive');
      await profile.toggleStatus({ force: true });
      await profile.dialog.expectClosed();
      await profile.expectStatusLabel('Inactive');
      // No PATCH /status was fired from either attempt.
      expect(statusRequests.count(), 'no PATCH /status may fire from a locked toggle').toBe(0);
      statusRequests.stop();
    },
  );

  test(
    'TC-ADMTOGGLE-002 post-handover activation dialog (exact copy) and confirmed toggle',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder, { status: 'inactive' });
      await list.searchTenants(t.companyName);
      const name = t.companyName;
      await list.clickCardToggle(name);
      // Exact activate dialog copy with the actual company name interpolated.
      await list.dialog.expectText(Copy.markActiveDialog(name));
      await list.dialog.confirm();
      await list.expectCardStatusLabel(name, 'Active');
      // Manual-toggle toast copy is unspecified (TC Gap #6) — assert presence only.
      await list.expectToastVisible();
      // Single underlying status: profile shows Active too.
      await list.openProfile(name);
      await profile.expectStatusLabel('Active');
    },
  );

  test(
    'TC-ADMTOGGLE-003 post-handover deactivation dialog includes the access-revocation warning',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder); // handover auto-activates → currently Active
      await list.searchTenants(t.companyName);
      const name = t.companyName;
      await list.openProfile(name);
      await profile.toggleStatus(); // from the PROFILE this time
      // Exact deactivate dialog copy incl. the revocation warning.
      await profile.dialog.expectText(Copy.markInactiveDialog(name));
      await profile.dialog.confirm();
      await profile.expectStatusLabel('Inactive');
      await profile.expectToastVisible();
      await profile.closeProfile();
      await list.expectCardStatusLabel(name, 'Inactive');
    },
  );

  test(
    'TC-ADMTOGGLE-004 canceling the toggle dialog reverts with no change',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      const name = t.companyName;
      const statusRequests = list.trackStatusPatchRequests();
      const labelBefore = await list.cardStatusLabelText(name);
      // 4a — cancel from the card.
      await list.clickCardToggle(name);
      await list.dialog.cancel();
      await list.expectCardStatusLabel(name, labelBefore);
      // 4b — cancel from the profile.
      await list.openProfile(name);
      await profile.toggleStatus();
      await profile.dialog.cancel();
      await profile.expectStatusLabel(labelBefore);
      await profile.closeProfile();
      // Status unchanged in card AND profile; no PATCH /status fired.
      await list.expectCardStatusLabel(name, labelBefore);
      expect(statusRequests.count(), 'no PATCH /status may fire on cancel').toBe(0);
      statusRequests.stop();
    },
  );

  test(
    'TC-ADMTOGGLE-005 rapid repeated toggle clicks open only one dialog',
    async ({ authenticatedTenantList: list, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      const name = t.companyName;
      const labelBefore = await list.cardStatusLabelText(name);
      await list.clickCardToggleRapidly(name, 5);
      // Exactly ONE confirmation dialog — clicks don't stack.
      await list.dialog.expectOpenCount(1);
      await list.dialog.cancel();
      // No further queued dialogs appear; status unchanged.
      await list.dialog.expectClosed();
      await list.expectCardStatusLabel(name, labelBefore);
    },
  );

  test(
    'TC-ADMTOGGLE-006 profile open at the moment of handover updates toggle live',
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Handover is irreversible → create a DISPOSABLE Setup tenant first.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      await list.expectLanded();
      await list.searchTenants(tenant.companyName);
      await list.openProfile(tenant.companyName);
      // Trigger handover from within the open profile (same-session variant).
      await profile.completeHandover();
      // Toggle/label/badge update live — no manual refresh.
      await profile.expectToggleEnabled();
      await profile.expectStatusLabel('Active');
      await profile.expectBadge('Handed Over');
    },
  );

  test(
    'TC-ADMTOGGLE-007 toggle works independently of section edit states',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedHandedOverTenant(seeder);
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
      // Put BOTH sections into edit mode with in-progress values.
      await profile.editCompanySection();
      await profile.editOwnerSection();
      await profile.fillCompanyAddress('Mid-edit address 123');
      await profile.fillOwnerName('Mid Edit Name');
      const labelBefore = await profile.statusLabelText();
      // Toggle + confirm while both sections are mid-edit.
      await profile.toggleStatus();
      await profile.dialog.confirm();
      // Status change applied; both sections remain in edit mode with the
      // in-progress values intact.
      await profile.expectStatusLabelNot(labelBefore);
      await profile.expectCompanySectionEditing();
      await profile.expectOwnerSectionEditing();
      await profile.expectCompanyAddressValue('Mid-edit address 123');
      await profile.expectOwnerNameValue('Mid Edit Name');
    },
  );
});
