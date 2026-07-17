/**
 * CEIQ-FEAT-003 — Edit User: name / role (US-UM-005 + §5.6).
 * Source: testcases/TC-CEIQ-FEAT-003.md — TC-UMEDIT-001…011.
 * SCAFFOLDED with test.skip (no screen/env yet). Verbatim copy from UmCopy.
 * Email-change branch (US-UM-006) lives in user-management-email.spec.ts.
 */
import { test, expect } from '@playwright/test';
import { UserManagementPage } from '../pages/UserManagementPage';
import { UmCopy } from './fixtures/expectedCopyUserMgmt';

test.describe('US-UM-005 Edit User name / role', () => {
  test.skip('TC-UMEDIT-001 edit modal pre-fills current Role/Name/Email; button reads "Save Changes"', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await expect(page.getByTestId('um-user-name-input')).toHaveValue('Kyle Chancellor');
    await expect(page.getByRole('button', { name: UmCopy.saveChangesButton })).toBeVisible();
  });

  test.skip('TC-UMEDIT-002 Branch A: name-only change → toast, no sign-out', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.fillUserForm({ name: 'Kyle C. Chancellor' });
    await um.submitSave();
    await um.expectToast(UmCopy.editSuccessToast('Kyle C. Chancellor'));
  });

  test.skip('TC-UMEDIT-003 Branch B: role change flips permission label immediately + immediate sign-out', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor'); // Analyst → Manager
    await um.fillUserForm({ role: 'Procurement Manager' });
    await um.submitSave();
    await expect(um.cardByName('Kyle Chancellor').getByText(UmCopy.permissionReadWrite)).toBeVisible();
  });

  test.skip('TC-UMEDIT-004 validation: cleared Name or invalid Email → same error, nothing saved', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.fillUserForm({ name: '' });
    await um.submitSave();
    await expect(page.getByText(UmCopy.createValidationError)).toBeVisible();
  });

  test.skip('TC-UMEDIT-005 cancel / close discards changes', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.fillUserForm({ name: 'Should Not Persist' });
    await um.cancelModal();
    await expect(um.cardByName('Should Not Persist')).toHaveCount(0);
  });

  test.skip('TC-UMEDIT-006 no-op: nothing changed → quiet success, no API call, no toast', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.submitSave(); // no edits
    await expect(um.toast).toHaveCount(0);
    await expect(page.getByTestId('um-user-modal')).toBeHidden();
  });

  test.skip('TC-UMEDIT-007 editing an Inactive user is allowed (status independent of details)', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Rania Khalil'); // Inactive user
    await um.fillUserForm({ name: 'Rania K.' });
    await um.submitSave();
    await um.expectToast(UmCopy.editSuccessToast('Rania K.'));
  });

  test.skip('TC-UMEDIT-008 role-change sign-out: affected user sees "Please log in again to continue"', async ({ page }) => {
    // Integration with FEAT-002 auth interceptor: after a role change, the affected
    // user's next action returns 401 → redirect to login with this exact message.
    await expect(page.getByText(UmCopy.reLoginMessage)).toBeVisible();
  });

  test.skip('TC-UMEDIT-009 role and name changed together apply in one save', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.fillUserForm({ name: 'Kyle Renamed', role: 'Procurement Analyst' });
    await um.submitSave();
    await um.expectToast(UmCopy.editSuccessToast('Kyle Renamed'));
    await expect(um.cardByName('Kyle Renamed').getByText(UmCopy.permissionReadOnly)).toBeVisible();
  });

  test.skip('TC-UMEDIT-010 loading state: "Save Changes" disables + shows a spinner during the API call', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.fillUserForm({ name: 'Slow Save' }); // with PATCH delayed
    await um.submitSave();
    await expect(page.getByRole('button', { name: UmCopy.saveChangesButton })).toBeDisabled();
  });

  test.skip('TC-UMEDIT-011 generic error on Edit for 5xx / network failure', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit('Kyle Chancellor');
    await um.fillUserForm({ name: 'Edit Error' });
    await um.submitSave(); // with PATCH mocked to 500
    await expect(page.getByText(UmCopy.genericError)).toBeVisible();
  });
});
