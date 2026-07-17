/**
 * App-level toast. The admin app shows these via antd `message.success/error`
 * (App message API), which render in a portal as `.ant-message-notice` with no
 * data-testid available — so we target antd's stable notice class. `.last()`
 * picks the most recent notice when several stack.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export function toastLocator(page: Page): Locator {
  return page.locator('.ant-message-notice').last();
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
