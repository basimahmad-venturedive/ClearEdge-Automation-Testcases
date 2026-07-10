/**
 * App-level toast (data-testid="toast" — TC-CEIQ-FEAT-001 §6).
 * Composed into page objects; specs assert through page-object methods.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TenantListLocators } from '../locators/tenantList';

export function toastLocator(page: Page): Locator {
  return page.getByTestId(TenantListLocators.toast);
}

/** Assert the toast shows the EXACT expected copy. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(toastLocator(page), 'toast copy').toHaveText(text);
}

/**
 * Assert a toast appeared without pinning its copy — used where the TC file
 * flags the toast text as unspecified (Gap #6: manual-toggle / edit-save
 * success toasts).
 */
export async function expectToastVisible(page: Page): Promise<void> {
  await expect(toastLocator(page), 'a toast is shown').toBeVisible();
}
