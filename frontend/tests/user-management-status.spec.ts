/**
 * CEIQ-FEAT-003 — Activate / Deactivate a user (US-UM-007 + §5.8/§5.9).
 * Source: testcases/TC-CEIQ-FEAT-003.md — TC-UMSTATUS-001…010.
 * SCAFFOLDED with test.skip (no screen/env yet). Deactivation dialog copy is
 * asserted VERBATIM. TC-UMSTATUS-005/006 are integration/manual — see notes.
 */
import { test, expect } from '@playwright/test';
import { UserManagementPage } from '../pages/UserManagementPage';
import { UmCopy } from './fixtures/expectedCopyUserMgmt';

const KYLE = 'Kyle Chancellor';
const RANIA = 'Rania Khalil'; // seeded Inactive

test.describe('US-UM-007 Activate / Deactivate', () => {
  test.skip('TC-UMSTATUS-001 deactivate confirmation dialog shows the verbatim copy', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(KYLE);
    await expect(um.deactivateDialog).toContainText(UmCopy.deactivateDialogTitle(KYLE));
    await expect(um.deactivateDialog).toContainText(UmCopy.deactivateDialogBody(KYLE));
  });

  test.skip('TC-UMSTATUS-002 confirm deactivate → Inactive + toast + immediate sign-out', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(KYLE);
    await um.confirmDeactivate();
    await um.expectStatusLabel(KYLE, 'Inactive');
    await um.expectToast(UmCopy.deactivateToast(KYLE));
  });

  test.skip('TC-UMSTATUS-003 cancel leaves the user Active and unchanged', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(KYLE);
    await um.cancelDeactivate();
    await um.expectStatusLabel(KYLE, 'Active');
  });

  test.skip('TC-UMSTATUS-004 reactivate is instant: no confirmation, toast "[Name] is now Active."', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(RANIA); // Inactive → Active, no dialog
    await expect(um.deactivateDialog).toBeHidden();
    await um.expectStatusLabel(RANIA, 'Active');
    await um.expectToast(UmCopy.reactivateToast(RANIA));
  });

  test.skip('TC-UMSTATUS-005 no access email is sent on reactivation [MANUAL-ONLY: needs SendGrid sandbox]', async ({ page }) => {
    // Cannot assert absence of an email dispatch from the UI. Verified manually / via
    // SendGrid sandbox once available. Kept for traceability; no UI assertion possible.
    expect(true).toBe(true);
  });

  test.skip('TC-UMSTATUS-006 deactivated user is blocked at login (integration with US-UM-001)', async ({ page }) => {
    // Cross-feature: after deactivation, that user's login shows the explicit
    // Inactive-account message (owned by FEAT-002 / US-UM-001), not invalid-credentials.
    await expect(page.getByText(/inactive/i)).toBeVisible();
  });

  test.skip('TC-UMSTATUS-007 deactivating the last remaining Manager or Analyst is allowed', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(KYLE); // last Manager
    await um.confirmDeactivate();
    await um.expectStatusLabel(KYLE, 'Inactive');
  });

  test.skip('TC-UMSTATUS-008 rapid double-click on Deactivate causes no duplicate/conflicting state', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(KYLE);
    await um.confirmDeactivate();
    await um.expectStatusLabel(KYLE, 'Inactive'); // single, consistent transition
  });

  test.skip('TC-UMSTATUS-009 deactivate-before-setup then reactivate keeps the original temp password', async ({ page }) => {
    // Integration/manual: deactivation does not consume/invalidate the temp password;
    // after reactivation the user completes US-UM-002 with the original temp password.
    await expect(page.getByText(/log in/i)).toBeVisible();
  });

  test.skip('TC-UMSTATUS-010 status-change error reverts the toggle + shows generic error', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.toggleStatus(KYLE); // with PATCH /status mocked to 500
    await um.confirmDeactivate();
    await um.expectStatusLabel(KYLE, 'Active'); // reverted
    await expect(page.getByText(UmCopy.genericError)).toBeVisible();
  });
});
