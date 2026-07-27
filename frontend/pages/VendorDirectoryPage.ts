/**
 * Page Object — Vendor Directory overview (CEIQ-FEAT-005 §11), VERIFIED against
 * the built tenant app (dev). Route: /vendors (left-nav item "Vendors", gated on
 * view_vendors). Locators: locators/vendors.ts. Copy: expectedCopyVendors.ts.
 *
 * Runs under the `po` project (PO storageState). Navigation preserves the session
 * exactly like CompanySettings/UserManagement: the app guards routes CLIENT-SIDE,
 * so a hard page.goto('/vendors') reloads and bounces to the dashboard. We reach
 * the screen via the left-nav menu item instead.
 *
 * Explicit / web-first waits only (no sleeps). Clear-before-input on text inputs.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { VendorLocators as L } from '../locators/vendors';
import { VendorCopy } from '../tests/fixtures/expectedCopyVendors';
import { appBaseUrl } from '../utils/env';

export class VendorDirectoryPage {
  constructor(readonly page: Page) {}

  private appUrl(path: string): string {
    return `${appBaseUrl().replace(/\/$/, '')}${path}`;
  }

  // ---------------------------------------------------------------- navigation
  /** Land on an in-app page with the shell present, without losing the session. */
  async ensureInApp(): Promise<void> {
    if (!this.page.url().startsWith(appBaseUrl().replace(/\/$/, ''))) {
      await this.page.goto(this.appUrl('/dashboard'));
    }
    // Full SPA boot on a throttled dev can exceed 30s on a fresh context; the nav
    // (menuitem) is the reliable "shell is ready" signal.
    await expect(this.page.getByRole('menuitem', { name: L.navItemName })).toBeVisible({
      timeout: 45000,
    });
  }

  /** True when the current path is the directory list (not a /vendors/:id profile). */
  private onList(): boolean {
    try {
      const path = new URL(this.page.url()).pathname.replace(/\/$/, '');
      return path === '/vendors';
    } catch {
      return false;
    }
  }

  /** Navigate to the /vendors LIST via the left-nav (keeps the PO session alive).
   *  A /vendors/:id profile counts as "not on the list", so this reliably returns
   *  to the directory from a detail page too. */
  async goto(): Promise<void> {
    if (!this.onList()) {
      await this.ensureInApp();
      await this.page.getByRole('menuitem', { name: L.navItemName }).click();
    }
    await this.page.waitForURL(/\/vendors(\?|#|$)/, { timeout: 30000 });
    await expect(this.page.getByTestId(L.listView)).toBeVisible({ timeout: 30000 });
  }

  /** True once the list has resolved to either the table or an empty state. */
  async waitForListSettled(): Promise<void> {
    await expect(
      this.page.getByTestId(L.table).or(this.page.getByTestId(L.emptyState)),
    ).toBeVisible({ timeout: 30000 });
  }

  // ------------------------------------------------------------------ elements
  get addButton(): Locator {
    return this.page.getByTestId(L.addButton);
  }
  get table(): Locator {
    return this.page.getByTestId(L.table);
  }
  get searchInput(): Locator {
    // testid is on the antd Input.Search wrapper div; the editable element is the
    // inner <input>, so scope to it for fill().
    return this.page.getByTestId(L.searchInput).locator('input');
  }
  get categorySelect(): Locator {
    return this.page.getByTestId(L.categorySelect);
  }
  get primaryOnlySwitch(): Locator {
    return this.page.getByTestId(L.primaryOnlySwitch);
  }
  get pagination(): Locator {
    return this.page.getByTestId(L.pagination);
  }
  get emptyState(): Locator {
    return this.page.getByTestId(L.emptyState);
  }
  get toast(): Locator {
    return this.page.locator(L.toastNotice).last();
  }

  // ------------------------------------------------------------------ rows
  /** Real data rows only. antd tags data rows `.ant-table-row`; this deliberately
   *  excludes the hidden `.ant-table-measure-row` (rendered under `scroll`) and
   *  the `.ant-table-placeholder` empty row, so counts are exact. */
  get rows(): Locator {
    return this.table.locator('tbody tr.ant-table-row');
  }
  /** The row whose Vendor cell contains `name` (unique enough for seeded data). */
  rowByName(name: string): Locator {
    return this.rows.filter({ hasText: name });
  }
  /** The clickable vendor-name link/cell within the named row. */
  nameCell(name: string): Locator {
    return this.rowByName(name).getByText(name, { exact: true }).first();
  }

  async rowCount(): Promise<number> {
    await this.waitForListSettled();
    if ((await this.table.count()) === 0) return 0;
    return this.rows.count();
  }

  /** Column header texts left-to-right (antd `th`). */
  async columnHeaderTexts(): Promise<string[]> {
    return this.page.locator(L.columnHeader).allTextContents().then((texts) => texts.map((t) => t.trim()));
  }

  /** Vendor names in current table order (name cells carry vendor-row-name-*). */
  async orderedVendorNames(): Promise<string[]> {
    return this.page
      .locator('[data-testid^="vendor-row-name-"]')
      .allTextContents()
      .then((names) => names.map((name) => name.trim()));
  }

  /** Click a sortable column header to toggle its sort (antd Table sorter). */
  async sortByColumn(headerName: 'Vendor' | 'Date Added'): Promise<void> {
    // exact — "Vendor" would otherwise also match the "Vendor ID" header.
    await this.page.getByRole('columnheader', { name: headerName, exact: true }).click();
  }

  // ---------------------------------------------------------------- pagination
  get nextPageButton(): Locator {
    return this.pagination.locator('.ant-pagination-next');
  }
  get prevPageButton(): Locator {
    return this.pagination.locator('.ant-pagination-prev');
  }
  async gotoNextPage(): Promise<void> {
    await this.nextPageButton.click();
  }
  /** antd marks a disabled pager arrow with `.ant-pagination-disabled`. */
  async isNextDisabled(): Promise<boolean> {
    return (await this.nextPageButton.getAttribute('class'))?.includes('ant-pagination-disabled') ?? false;
  }
  async isPrevDisabled(): Promise<boolean> {
    return (await this.prevPageButton.getAttribute('class'))?.includes('ant-pagination-disabled') ?? false;
  }

  // ---------------------------------------------------------- search / filter
  async search(text: string): Promise<void> {
    await this.searchInput.fill(''); // clear-before-input
    if (text) await this.searchInput.fill(text);
  }

  /** Pick a category-filter option by its visible label (antd Select portal). */
  async selectCategory(label: string): Promise<void> {
    await this.categorySelect.click();
    await this.page.locator(L.selectOption, { hasText: label }).first().click();
  }

  async togglePrimaryOnly(): Promise<void> {
    await this.primaryOnlySwitch.click();
  }

  // ---------------------------------------------------------------- open flows
  async openCreate(): Promise<void> {
    await this.addButton.click();
    // testid is on the zero-size `.ant-modal-root`; assert on the visible panel.
    const modal = this.page.getByTestId(L.createModal).locator('.ant-modal').first();
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(VendorCopy.createModalTitle);
  }

  /** Click a vendor name to open its profile; resolves the new URL. */
  async openProfileByName(name: string): Promise<void> {
    await this.nameCell(name).click();
    await this.page.waitForURL(/\/vendors\/[^/]+$/, { timeout: 30000 });
  }

  // ---------------------------------------------------------------- assertions
  async expectToast(text: string): Promise<void> {
    await expect(this.toast).toHaveText(text);
  }
}
