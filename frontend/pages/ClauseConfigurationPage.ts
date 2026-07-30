/**
 * Page Object — CEIQ-FEAT-006 Clause Configuration (tenant app).
 * antd UI, no data-testids → role/text locators (see locators/clauseConfiguration.ts).
 */
import { type Page, type Locator, expect } from '@playwright/test';
import { ClauseCopy } from '../tests/fixtures/expectedCopyClause';
import { ClauseLocators as L } from '../locators/clauseConfiguration';
import { appBaseUrl } from '../utils/env';

export class ClauseConfigurationPage {
  constructor(private readonly page: Page) {}

  // --- navigation ---
  async goto(): Promise<void> {
    // Clause Configuration is a Procurement-Owner screen in the MAIN ClearEdge app
    // (APP_BASE_URL), NOT the admin portal. A bare relative goto would resolve against
    // the `po` project's inherited admin baseURL (E2E_BASE_URL) → wrong host. Force the
    // app origin, mirroring CompanySettingsPage / VendorDirectoryPage.
    await this.page.goto(`${appBaseUrl().replace(/\/$/, '')}${ClauseCopy.route}`);
  }

  async expectLanded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: ClauseCopy.title })).toBeVisible();
    await expect(this.page).toHaveURL(new RegExp(`${ClauseCopy.route}(\\b|$|\\?)`));
  }

  // --- header controls ---
  editButton(): Locator {
    return this.page.getByRole('button', { name: ClauseCopy.editButton, exact: true });
  }
  discardButton(): Locator {
    return this.page.getByRole('button', { name: ClauseCopy.discardButton, exact: true });
  }
  saveButton(): Locator {
    return this.page.getByRole('button', { name: ClauseCopy.saveButton, exact: true });
  }

  // --- structure ---
  banner(): Locator {
    return this.page.locator(L.alert).filter({ hasText: 'All selected clauses will be used' });
  }
  columnHeader(name: string): Locator {
    return this.page.getByRole('columnheader', { name, exact: false });
  }
  rows(): Locator {
    return this.page.locator(L.tableRows);
  }
  toast(): Locator {
    return this.page.locator(L.toast);
  }

  // --- actions ---
  async enterEditMode(): Promise<void> {
    await this.editButton().click();
    await expect(this.saveButton()).toBeVisible();
  }

  async discard(): Promise<void> {
    await this.discardButton().click();
  }

  /** Hover the disabled Save button and return the visible tooltip text. */
  async saveTooltipText(): Promise<string> {
    await this.saveButton().hover();
    const tip = this.page.locator(L.tooltip).filter({ hasText: 'enabled once the clause library' });
    await expect(tip).toBeVisible();
    return (await tip.textContent())?.trim() ?? '';
  }
}
