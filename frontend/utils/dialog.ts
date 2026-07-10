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
    return this.page.getByRole('dialog');
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
    await expect(this.confirmButton, 'confirming button disabled while the call is in flight').toBeDisabled();
    await expect(
      this.root.getByTestId(TenantListLocators.loadingIndicator),
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
