/**
 * CEIQ-FEAT-001 — UI Active/Inactive Toggle (US-2.2).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMTOGGLE-001…007.
 *
 * Every test is test(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 */
import { test, expect, FIXME_DETAILS } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { SETUP_TENANT, HANDED_OVER_TENANT, uniqueTenant } from './fixtures/testData';

test.describe('US-2.2 Active/Inactive Toggle', () => {
  test(
    'TC-ADMTOGGLE-001 toggle locked to Inactive while tenant is in Setup (card + profile)',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): SETUP_TENANT seeded in Setup.
      const statusRequests = list.trackStatusPatchRequests();
      // Card: toggle disabled, label "Inactive"; clicking changes nothing.
      await list.expectCardToggleDisabled(SETUP_TENANT.companyName);
      await list.expectCardStatusLabel(SETUP_TENANT.companyName, 'Inactive');
      await list.clickCardToggle(SETUP_TENANT.companyName, { force: true }); // deliberate attempt on a disabled control
      await list.dialog.expectClosed();
      await list.expectCardStatusLabel(SETUP_TENANT.companyName, 'Inactive');
      // Profile: same lock.
      await list.openProfile(SETUP_TENANT.companyName);
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
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): HANDED_OVER_TENANT handed over, currently Inactive.
      const name = HANDED_OVER_TENANT.companyName;
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
      // Cleanup: toggle back to the original state.
      await profile.toggleStatus();
      await profile.dialog.confirm();
      await profile.expectStatusLabel('Inactive');
    },
  );

  test(
    'TC-ADMTOGGLE-003 post-handover deactivation dialog includes the access-revocation warning',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): HANDED_OVER_TENANT handed over, currently Active.
      const name = HANDED_OVER_TENANT.companyName;
      await list.openProfile(name);
      await profile.toggleStatus(); // from the PROFILE this time
      // Exact deactivate dialog copy incl. the revocation warning ("ClearEdge
      // application" per story text — spec discrepancy log #1).
      await profile.dialog.expectText(Copy.markInactiveDialog(name));
      await profile.dialog.confirm();
      await profile.expectStatusLabel('Inactive');
      await profile.expectToastVisible();
      await profile.closeProfile();
      await list.expectCardStatusLabel(name, 'Inactive');
      // Cleanup: restore Active.
      await list.clickCardToggle(name);
      await list.dialog.confirm();
      await list.expectCardStatusLabel(name, 'Active');
    },
  );

  test(
    'TC-ADMTOGGLE-004 canceling the toggle dialog reverts with no change',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): HANDED_OVER_TENANT handed over (either status).
      const name = HANDED_OVER_TENANT.companyName;
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
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): HANDED_OVER_TENANT handed over.
      const name = HANDED_OVER_TENANT.companyName;
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
      await list.openProfile(tenant.companyName);
      // Trigger handover from within the open profile (same-session variant).
      await profile.completeHandover();
      // Toggle/label/badge update live — no manual refresh.
      await profile.expectToggleEnabled();
      await profile.expectStatusLabel('Active');
      await profile.expectBadge('Handed Over');
      // Cross-session variant is untestable until the update mechanism is
      // specified (TC Clarification #5).
    },
  );

  test(
    'TC-ADMTOGGLE-007 toggle works independently of section edit states',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): HANDED_OVER_TENANT handed over.
      await list.openProfile(HANDED_OVER_TENANT.companyName);
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
      // Cleanup: cancel edits; restore status.
      await profile.cancelCompanySection();
      await profile.cancelOwnerSection();
      await profile.toggleStatus();
      await profile.dialog.confirm();
      await profile.expectStatusLabel(labelBefore);
    },
  );
});
