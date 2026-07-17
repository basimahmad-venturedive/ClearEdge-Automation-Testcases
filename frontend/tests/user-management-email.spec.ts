/**
 * CEIQ-FEAT-003 — Change User Email (US-UM-006 + §5.7).
 * Source: testcases/TC-CEIQ-FEAT-003.md — TC-UMEMAIL-001…009.
 * SCAFFOLDED with test.skip (no screen/env yet). Confirmation dialog copy is
 * asserted VERBATIM via UmCopy.emailChangeDialogBody(...).
 */
import { test, expect } from '@playwright/test';
import { UserManagementPage } from '../pages/UserManagementPage';
import { UmCopy } from './fixtures/expectedCopyUserMgmt';

const KYLE = 'Kyle Chancellor';
const OLD_EMAIL = 'kyle.chancellor@clearedge.com';

test.describe('US-UM-006 Change User Email', () => {
  test.skip('TC-UMEMAIL-001 case-only email change is not a real change (no dialog, no uniqueness check)', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'KYLE.CHANCELLOR@clearedge.com' });
    await um.submitSave();
    await expect(um.emailConfirmDialog).toBeHidden();
  });

  test.skip('TC-UMEMAIL-002 genuine email change → uniqueness checked, then confirmation dialog with verbatim dynamic copy', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'kyle.new@clearedge.com' });
    await um.submitSave();
    await expect(um.emailConfirmDialog).toContainText(UmCopy.emailChangeDialogTitle);
    await expect(um.emailConfirmDialog).toContainText(
      UmCopy.emailChangeDialogBody(KYLE, OLD_EMAIL, 'kyle.new@clearedge.com'),
    );
  });

  test.skip('TC-UMEMAIL-003 same-tenant email clash blocks the dialog → explicit message', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'peer.same@clearedge.com' });
    await um.submitSave();
    await expect(um.emailConfirmDialog).toBeHidden();
    await um.expectEmailFieldError(UmCopy.createEmailSameTenant);
  });

  test.skip('TC-UMEMAIL-004 cross-tenant email clash blocks the dialog → narrower message', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'peer.other@othertenant.com' });
    await um.submitSave();
    await expect(um.emailConfirmDialog).toBeHidden();
    await um.expectEmailFieldError(UmCopy.createEmailCrossTenant);
  });

  test.skip('TC-UMEMAIL-005 confirm → old email loses access + immediate sign-out + banner', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'kyle.new@clearedge.com' });
    await um.submitSave();
    await um.confirmEmailChange();
    await um.expectBanner(UmCopy.emailChangeBanner('kyle.new@clearedge.com'));
  });

  test.skip('TC-UMEMAIL-006 cancel leaves everything unchanged with the attempted email still in the field', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'kyle.new@clearedge.com' });
    await um.submitSave();
    await um.cancelEmailChange();
    await expect(page.getByTestId('um-user-email-input')).toHaveValue('kyle.new@clearedge.com');
  });

  test.skip('TC-UMEMAIL-007 Escape / outside-click on the confirmation dialog behaves exactly like Cancel', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'kyle.new@clearedge.com' });
    await um.submitSave();
    await page.keyboard.press('Escape');
    await expect(um.emailConfirmDialog).toBeHidden();
    await expect(page.getByTestId('um-user-email-input')).toHaveValue('kyle.new@clearedge.com');
  });

  test.skip('TC-UMEMAIL-008 name/role changes apply together with a confirmed email change', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ name: 'Kyle New', role: 'Procurement Analyst', email: 'kyle.new@clearedge.com' });
    await um.submitSave();
    await um.confirmEmailChange();
    await um.expectToast(UmCopy.editSuccessToast('Kyle New'));
  });

  test.skip('TC-UMEMAIL-009 clash returned on Confirm → dialog closes, error shows on the email field', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openEdit(KYLE);
    await um.fillUserForm({ email: 'kyle.new@clearedge.com' });
    await um.submitSave();
    await um.confirmEmailChange(); // backend returns clash on confirm
    await expect(um.emailConfirmDialog).toBeHidden();
    await um.expectEmailFieldError(UmCopy.createEmailCrossTenant);
  });
});
