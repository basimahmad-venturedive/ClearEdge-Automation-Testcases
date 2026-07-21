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

export interface UserFormValues {
  role: 'Procurement Manager' | 'Procurement Analyst';
  name: string;
  email: string;
}

export class UserManagementPage {
  constructor(readonly page: Page) {}

  // ---------------------------------------------------------------- navigation
  // The app guards /user-management CLIENT-SIDE with an in-memory session — a
  // hard page.goto reloads and loses it (bounces to /dashboard). So navigate via
  // the app nav menu item instead, preserving the PO session. Assumes login
  // already happened (AppLoginPage.loginAsPO in a beforeEach) and we're in the app.
  async goto(): Promise<void> {
    if (!this.page.url().includes('/user-management')) {
      await this.page.getByRole('menuitem', { name: 'User Management' }).click();
    }
    await this.page.waitForURL(/\/user-management/, { timeout: 30000 });
    // Heading specifically — "User Management" also appears as a nav menu item.
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
  async expectOrganizationCard(companyName: string): Promise<void> {
    const card = this.page.getByTestId(L.orgCard);
    await expect(card).toBeVisible();
    await expect(card.getByTestId(L.orgCompanyName)).toHaveText(companyName);
    // No edit controls in the card.
    await expect(card.getByRole('button', { name: /edit/i })).toHaveCount(0);
  }

  async expectProfileCard(name: string, email: string): Promise<void> {
    const card = this.page.getByTestId(L.profileCard);
    await expect(card.getByTestId(L.profileName)).toHaveText(name);
    await expect(card.getByTestId(L.profileEmail)).toHaveText(email);
    await expect(card.getByTestId(L.profileRole)).toHaveText(UmCopy.profileRole);
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
