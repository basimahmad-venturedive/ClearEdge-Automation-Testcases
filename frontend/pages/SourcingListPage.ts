/**
 * Page Object — CEIQ-FEAT-007 Sourcing Events list (/sourcing). antd UI; list
 * uses text-based tabs + a search box + empty-state, so role/text locators.
 * Navigation forces the main-app origin (APP_BASE_URL) like the vendor/clause POMs.
 */
import { type Page, type Locator, expect } from '@playwright/test';
import { SourcingCopy } from '../tests/fixtures/expectedCopySourcing';
import { appBaseUrl } from '../utils/env';

export class SourcingListPage {
  constructor(private readonly page: Page) {}

  /** The left-sidebar "Sourcing" menu item (antd Menu, role=menuitem, gated by view_sourcing). */
  navItem(): Locator {
    return this.page.getByRole('menuitem', { name: SourcingCopy.navItemName, exact: false });
  }

  /**
   * Reach Sourcing the way a user does: land on an in-app page (dashboard),
   * then CLICK the left-sidebar "Sourcing" tab — not via a direct /sourcing URL
   * (the app bounces the first post-login deep link to /dashboard).
   */
  async goto(): Promise<void> {
    await this.page.goto(`${appBaseUrl().replace(/\/$/, '')}/dashboard`);
    await expect(this.navItem()).toBeVisible();
    await this.navItem().click();
    await expect(this.page).toHaveURL(new RegExp(`${SourcingCopy.route}(\\b|$|\\?)`));
  }

  async expectLanded(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`${SourcingCopy.route}(\\b|$|\\?)`));
    await expect(this.newButton()).toBeVisible();
  }

  promptModal(): Locator {
    return this.page.getByTestId(SourcingCopy.testids.promptModal);
  }
  skipButton(): Locator {
    return this.page.getByTestId(SourcingCopy.testids.skipButton);
  }

  newButton(): Locator {
    return this.page.getByRole('button', { name: SourcingCopy.newButton, exact: false });
  }

  tab(name: string): Locator {
    return this.page.getByRole('tab', { name, exact: false });
  }

  searchBox(): Locator {
    return this.page.getByPlaceholder(SourcingCopy.searchPlaceholder);
  }

  emptyState(): Locator {
    return this.page.getByText(SourcingCopy.emptyState, { exact: false });
  }

  rows(): Locator {
    return this.page.locator('.ant-table-tbody tr.ant-table-row');
  }

  /** Open the "New sourcing" AI-prompt modal (SRC-01 entry). */
  async openNew(): Promise<void> {
    await this.newButton().click();
  }
}
