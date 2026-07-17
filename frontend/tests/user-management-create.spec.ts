/**
 * CEIQ-FEAT-003 — Create User modal (US-UM-004 + §5.5).
 * Source: testcases/TC-CEIQ-FEAT-003.md — TC-UMCREATE-001…013.
 * SCAFFOLDED with test.skip (no screen/env yet). Verbatim copy from UmCopy.
 * TODO_FIXTURE: PO session + seeded roster + API teardown of created users.
 */
import { test, expect } from '@playwright/test';
import { UserManagementPage } from '../pages/UserManagementPage';
import { UmCopy } from './fixtures/expectedCopyUserMgmt';

test.describe('US-UM-004 Create User', () => {
  test.skip('TC-UMCREATE-001 happy path: create a Manager → banner + toast + card at top of list', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ role: 'Procurement Manager', name: 'Kyle Chancellor', email: 'kyle.chancellor@clearedge.com' });
    await um.submitCreate();
    await um.expectBanner(UmCopy.createSuccessBanner('kyle.chancellor@clearedge.com'));
    await um.expectToast(UmCopy.createSuccessToast('Kyle Chancellor'));
  });

  test.skip('TC-UMCREATE-002 create a Procurement Analyst → permission label "Read Only"', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ role: 'Procurement Analyst', name: 'Priya', email: 'priya@clearedge.com' });
    await um.submitCreate();
    await expect(um.cardByName('Priya').getByText(UmCopy.permissionReadOnly)).toBeVisible();
  });

  test.skip('TC-UMCREATE-003 form defaults and role sublabels', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await expect(page.getByRole('radio', { name: 'Procurement Manager' })).toBeChecked();
    await expect(page.getByText(UmCopy.roleManagerSublabel)).toBeVisible();
    await expect(page.getByText(UmCopy.roleAnalystSublabel)).toBeVisible();
  });

  test.skip('TC-UMCREATE-004 validation: empty name / empty or invalid email → exact message', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: '', email: 'not-an-email' });
    await um.submitCreate();
    await expect(page.getByText(UmCopy.createValidationError)).toBeVisible();
  });

  test.skip('TC-UMCREATE-005 whitespace-only Name rejected', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: '   ', email: 'valid@clearedge.com' });
    await um.submitCreate();
    await expect(page.getByText(UmCopy.createValidationError)).toBeVisible();
  });

  test.skip('TC-UMCREATE-006 same-tenant email clash → explicit "in your organization" message', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: 'Dup User', email: 'existing.same@clearedge.com' });
    await um.submitCreate();
    await um.expectEmailFieldError(UmCopy.createEmailSameTenant);
  });

  test.skip('TC-UMCREATE-007 cross-tenant email clash → narrower "already in use" message', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: 'Other Tenant', email: 'existing.other@othertenant.com' });
    await um.submitCreate();
    await um.expectEmailFieldError(UmCopy.createEmailCrossTenant);
  });

  test.skip('TC-UMCREATE-008 cancel discards entered data', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: 'Discarded', email: 'discard@clearedge.com' });
    await um.cancelModal();
    await um.openCreate();
    await expect(page.getByTestId('um-user-name-input')).toHaveValue('');
  });

  test.skip('TC-UMCREATE-009 special characters in Name rendered safely', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: "Zoë O'Neil-<script>", email: 'zoe@clearedge.com' });
    await um.submitCreate();
    // Name shown as literal text, not executed/broken markup.
    await expect(um.cardByName("Zoë O'Neil-<script>")).toBeVisible();
  });

  test.skip('TC-UMCREATE-010 double-submit prevention: one user, button disabled in-flight', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: 'Once Only', email: 'once@clearedge.com' });
    await um.submitCreate();
    await expect(page.getByRole('button', { name: 'Create User' }).last()).toBeDisabled();
  });

  test.skip("TC-UMCREATE-011 owner's own email is treated as a same-tenant clash", async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: 'Owner Clash', email: 'owner@clearedge.com' });
    await um.submitCreate();
    await um.expectEmailFieldError(UmCopy.createEmailSameTenant);
  });

  test.skip('TC-UMCREATE-012 close behavior: X / Escape / outside-click all act as Cancel', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('um-user-modal')).toBeHidden();
  });

  test.skip('TC-UMCREATE-013 generic error on Create for 5xx / network failure', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.openCreate();
    await um.fillUserForm({ name: 'Server Error', email: 'err@clearedge.com' });
    await um.submitCreate(); // with POST /users mocked to 500
    await expect(page.getByText(UmCopy.genericError)).toBeVisible();
  });
});
