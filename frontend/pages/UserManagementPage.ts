/**
 * Page Object — User Management home + Create/Edit modals + confirmation dialogs.
 * CEIQ-FEAT-003 §5. Locators: locators/userManagement.ts (proposed contract).
 * Copy: tests/fixtures/expectedCopyUserMgmt.ts (spec-pinned, verbatim).
 *
 * Self-contained: construct with `new UserManagementPage(page)` — does not depend
 * on the FEAT-001 baseTest fixture. Explicit / web-first waits only (no sleeps).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { UserManagementLocators as L } from '../locators/userManagement';
import { UmCopy } from '../tests/fixtures/expectedCopyUserMgmt';
import { appBaseUrl } from '../utils/env';

export interface UserFormValues {
  role: 'Procurement Manager' | 'Procurement Analyst';
  name: string;
  email: string;
}

export class UserManagementPage {
  constructor(readonly page: Page) {}

  // ---------------------------------------------------------------- navigation
  // The app guards /user-management CLIENT-SIDE with an in-memory session — a
  // hard page.goto reloads and loses it (bounces to /dashboard). "User Management"
  // also moved OUT of the left nav INTO the avatar dropdown (AppShell.tsx: it now
  // lives below Company Settings, gated by the manage_users right). So navigate the
  // same way CompanySettingsPage does: land in-app, open the avatar dropdown, then
  // click the "User Management" item — preserving the PO session. Assumes login
  // already happened (AppLoginPage.ensureLoggedIn in a beforeEach).
  private appUrl(path: string): string {
    return `${appBaseUrl().replace(/\/$/, '')}${path}`;
  }

  /** Land on an in-app page with the shell present, without losing the session. */
  async ensureInApp(): Promise<void> {
    if (!this.page.url().startsWith(appBaseUrl().replace(/\/$/, ''))) {
      await this.page.goto(this.appUrl('/dashboard'));
    }
    await expect(this.page.locator('.ant-avatar').first()).toBeVisible({ timeout: 45000 });
  }

  /** Open the avatar dropdown that hosts the "User Management" item. */
  async openAccountMenu(): Promise<void> {
    await this.page.locator('.ant-avatar').first().click();
  }

  async goto(): Promise<void> {
    if (!this.page.url().includes('/user-management')) {
      await this.ensureInApp();
      await this.openAccountMenu();
      await this.page.getByRole('menuitem', { name: 'User Management' }).click();
    }
    await this.page.waitForURL(/\/user-management/, { timeout: 30000 });
    // Heading specifically — "User Management" also appears as a menu item.
    await expect(this.page.getByRole('heading', { name: UmCopy.pageTitle })).toBeVisible();
  }

  // ------------------------------------------------------------------ locators
  get cards(): Locator {
    return this.page.getByTestId(L.userCard);
  }
  get searchBar(): Locator {
    return this.page.getByTestId(L.searchBar);
  }
  get toast(): Locator {
    // antd App.message renders in a portal as `.ant-message-notice` (no testid).
    return this.page.locator('.ant-message-notice').last();
  }
  get banner(): Locator {
    return this.page.getByTestId(L.banner);
  }
  get emailFieldError(): Locator {
    // antd renders the field error in `.ant-form-item-explain-error`; scope it to
    // the email input's Form.Item (the input carries um-user-email-input).
    return this.page
      .locator('.ant-form-item', { has: this.page.getByTestId(L.emailInput) })
      .locator('.ant-form-item-explain-error');
  }
  cardByName(name: string): Locator {
    return this.cards.filter({ hasText: name });
  }
  /** The Create/Edit user modal (same testid; only one open at a time). */
  get modal(): Locator {
    return this.page.getByTestId(L.modal);
  }

  // ------------------------------------------------------------- summary cards
  // Identity values (company name, PO display name) are per-tenant DATA, not spec
  // invariants, so we assert the AC invariants instead of hardcoding a specific
  // tenant's strings: the fields RENDER (non-empty), the logged-in PO's EMAIL is
  // shown exactly (env truth), the ROLE is exactly "Procurement Owner", and there
  // are NO edit controls. This keeps the case correct on any environment.
  async expectOrganizationCard(): Promise<void> {
    const card = this.page.getByTestId(L.orgCard);
    await expect(card).toBeVisible();
    // Company / website / address all render (a null field shows the "—" placeholder,
    // which is still non-empty text — §5.2).
    await expect(card.getByTestId(L.orgCompanyName)).not.toBeEmpty();
    await expect(card.getByTestId(L.orgWebsite)).not.toBeEmpty();
    await expect(card.getByTestId(L.orgAddress)).not.toBeEmpty();
    // No edit controls in the card.
    await expect(card.getByRole('button', { name: /edit/i })).toHaveCount(0);
  }

  async expectProfileCard(email: string): Promise<void> {
    const card = this.page.getByTestId(L.profileCard);
    await expect(card.getByTestId(L.profileName)).not.toBeEmpty();
    await expect(card.getByTestId(L.profileEmail)).toHaveText(email);
    await expect(card.getByTestId(L.profileRole)).toHaveText(UmCopy.profileRole);
    // No edit controls in the card.
    await expect(card.getByRole('button', { name: /edit/i })).toHaveCount(0);
  }

  // --------------------------------------------------------- search and filter
  async search(text: string): Promise<void> {
    await this.searchBar.fill(''); // clear-before-input
    if (text) await this.searchBar.fill(text);
  }

  async selectRoleFilter(role: 'All' | 'Procurement Manager' | 'Procurement Analyst'): Promise<void> {
    // antd optionType="button" radios hide the <input role=radio> (opacity:0), so
    // .check() times out on visibility — click the visible button label instead.
    await this.page
      .locator('label.ant-radio-button-wrapper')
      .filter({ hasText: new RegExp(`^${role}$`) })
      .click();
  }

  async expectNoMatchEmptyState(): Promise<void> {
    await expect(this.page.getByTestId(L.emptyStateNoMatch)).toHaveText(UmCopy.emptyNoMatch);
  }

  async expectNoUsersEmptyState(): Promise<void> {
    await expect(this.page.getByTestId(L.emptyStateNoUsers)).toHaveText(UmCopy.emptyNoUsers);
    // Search + filter remain visible in this state (§5.2).
    await expect(this.searchBar).toBeVisible();
  }

  async expectVisibleCardNames(): Promise<string[]> {
    return this.cards.getByTestId(L.cardName).allTextContents();
  }

  // -------------------------------------------------------------- create modal
  async openCreate(): Promise<void> {
    await this.page.getByRole('button', { name: L.createUserButtonName }).click();
    await expect(this.modal, 'create modal open').toBeVisible();
    await expect(this.modal).toContainText(UmCopy.createModalTitle);
  }

  async fillUserForm(values: Partial<UserFormValues>): Promise<void> {
    if (values.role) await this.page.getByRole('radio', { name: values.role }).check();
    if (values.name !== undefined) {
      await this.page.getByTestId(L.fullNameInput).fill('');
      await this.page.getByTestId(L.fullNameInput).fill(values.name);
    }
    if (values.email !== undefined) {
      await this.page.getByTestId(L.emailInput).fill('');
      await this.page.getByTestId(L.emailInput).fill(values.email);
    }
  }

  async submitCreate(): Promise<void> {
    await this.modal.getByRole('button', { name: L.submitCreateName }).click();
  }

  async cancelModal(): Promise<void> {
    await this.modal.getByRole('button', { name: L.cancelName }).click();
  }

  // ---------------------------------------------------------------- edit modal
  async openEdit(userName: string): Promise<void> {
    await this.cardByName(userName).getByRole('button', { name: L.cardEditButtonName }).click();
    await expect(this.modal, 'edit modal open').toBeVisible();
    await expect(this.modal).toContainText(UmCopy.editModalTitle);
  }

  async submitSave(): Promise<void> {
    await this.modal.getByRole('button', { name: L.submitSaveName }).click();
  }

  // ----------------------------------------------- email-change confirm dialog
  get emailConfirmDialog(): Locator {
    return this.page.getByTestId(L.emailConfirmDialog);
  }
  async confirmEmailChange(): Promise<void> {
    await this.emailConfirmDialog.getByRole('button', { name: L.emailConfirmName }).click();
  }
  async cancelEmailChange(): Promise<void> {
    await this.emailConfirmDialog.getByRole('button', { name: L.emailConfirmCancelName }).click();
  }

  // ------------------------------------------------ status toggle + deactivate
  async toggleStatus(userName: string): Promise<void> {
    await this.cardByName(userName).getByTestId(L.cardStatusToggle).click();
  }
  get deactivateDialog(): Locator {
    return this.page.getByTestId(L.deactivateDialog);
  }
  async confirmDeactivate(): Promise<void> {
    await this.deactivateDialog.getByRole('button', { name: L.deactivateConfirmName }).click();
  }
  async cancelDeactivate(): Promise<void> {
    await this.deactivateDialog.getByRole('button', { name: L.deactivateCancelName }).click();
  }
  async expectStatusLabel(userName: string, label: 'Active' | 'Inactive'): Promise<void> {
    await expect(this.cardByName(userName).getByTestId(L.cardStatusLabel)).toHaveText(label);
  }

  // ------------------------------------------------------------ notifications
  async expectToast(text: string): Promise<void> {
    await expect(this.toast).toHaveText(text);
  }
  async expectBanner(text: string): Promise<void> {
    await expect(this.banner).toHaveText(text);
  }
  async expectEmailFieldError(text: string): Promise<void> {
    await expect(this.emailFieldError).toHaveText(text);
  }
}
