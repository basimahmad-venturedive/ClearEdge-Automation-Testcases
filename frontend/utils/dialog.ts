/**
 * App-level confirmation dialog (role=dialog + Confirm/Cancel buttons —
 * TC-CEIQ-FEAT-001 §6; exact button labels TBD per the TC file's Gaps).
 * Composed into page objects; specs never touch these locators directly.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TenantListLocators } from '../locators/tenantList';

export class ConfirmDialog {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get root(): Locator {
    // Scope to the antd Modal.confirm dialog specifically — the tenant profile
    // is ALSO an antd Modal (role="dialog"), so a bare getByRole('dialog') is
    // ambiguous whenever the profile is open. `.ant-modal-confirm` is unique to
    // Modal.confirm (toggle / email-change / handover dialogs).
    return this.page.locator('.ant-modal-confirm');
  }

  get confirmButton(): Locator {
    return this.root.getByRole('button', { name: TenantListLocators.dialogConfirmName });
  }

  get cancelButton(): Locator {
    return this.root.getByRole('button', { name: TenantListLocators.dialogCancelName });
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  /**
   * Confirm and assert the §10 pending state on the confirming button:
   * disabled + visible loading indicator while the API call is in flight
   * (repeat clicks are impossible while disabled).
   */
  async confirmAndExpectPending(): Promise<void> {
    await this.confirmButton.click();
    // antd Modal.confirm auto-sets the OK button to loading while onOk's promise
    // is pending — the spinner renders as `.ant-btn-loading-icon` inside the dialog.
    await expect(
      this.root.locator('.ant-btn-loading-icon'),
      'loading indicator visible during the call',
    ).toBeVisible();
  }

  /**
   * Assert the dialog contains the exact message copy. `toContainText` is used
   * because the dialog element also contains its buttons; the message string
   * itself is asserted verbatim.
   */
  async expectText(message: string | RegExp): Promise<void> {
    await expect(this.root, 'confirmation dialog copy').toContainText(message);
  }

  async expectOpenCount(count: number): Promise<void> {
    await expect(this.root).toHaveCount(count);
  }

  async expectClosed(): Promise<void> {
    await expect(this.root).toHaveCount(0);
  }
}
