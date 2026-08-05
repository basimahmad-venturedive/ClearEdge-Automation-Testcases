/**
 * Page Object — CEIQ-FEAT-007 Sourcing event detail (/sourcing/:id). antd UI with
 * real data-testids. Reached by warming the app via the sidebar (SourcingListPage.goto),
 * then opening the specific event — the app only bounces the FIRST post-login deep link,
 * so once the sidebar has landed us on /sourcing, opening a known event id is stable.
 */
import { type Page, type Locator, expect } from '@playwright/test';
import { appBaseUrl } from '../utils/env';
import { SourcingListPage } from './SourcingListPage';

export const SourcingDetailTestIds = {
  header: 'sourcing-detail-header',
  editButton: 'sourcing-detail-edit-button',
  deleteButton: 'sourcing-detail-delete-button',
  inviteButton: 'sourcing-detail-invite-button',
  tabsContainer: 'sourcing-tabs-container',
  detailsCard: 'sourcing-details-card',
  criteriaSummaryCard: 'sourcing-evaluation-criteria-summary-card',
  vendorOverviewCard: 'sourcing-vendor-overview-card',
  notFoundResult: 'sourcing-detail-not-found-result',
} as const;

export class SourcingDetailPage {
  constructor(private readonly page: Page) {}

  private appUrl(path: string): string {
    return `${appBaseUrl().replace(/\/$/, '')}${path}`;
  }

  /** Warm the app via the left-sidebar "Sourcing" tab, then open the given event. */
  async gotoEvent(id: string): Promise<void> {
    await new SourcingListPage(this.page).goto(); // sidebar → /sourcing (warms the SPA)
    await this.page.goto(this.appUrl(`/sourcing/${id}`));
    await expect(this.header()).toBeVisible();
  }

  header(): Locator { return this.page.getByTestId(SourcingDetailTestIds.header); }
  editButton(): Locator { return this.page.getByTestId(SourcingDetailTestIds.editButton); }
  deleteButton(): Locator { return this.page.getByTestId(SourcingDetailTestIds.deleteButton); }
  inviteButton(): Locator { return this.page.getByTestId(SourcingDetailTestIds.inviteButton); }
  tabsContainer(): Locator { return this.page.getByTestId(SourcingDetailTestIds.tabsContainer); }
  detailsCard(): Locator { return this.page.getByTestId(SourcingDetailTestIds.detailsCard); }
  criteriaSummaryCard(): Locator { return this.page.getByTestId(SourcingDetailTestIds.criteriaSummaryCard); }

  /** A detail tab by accessible name (antd Tabs → role=tab). */
  tab(name: string | RegExp): Locator { return this.page.getByRole('tab', { name }); }
  deleteModalTitle(): Locator { return this.page.getByText('Delete this sourcing event?', { exact: false }); }
  deleteConfirmButton(): Locator { return this.page.getByRole('button', { name: 'Delete permanently' }); }
  inviteModalSearch(): Locator { return this.page.getByTestId('sourcing-invite-modal-search-input'); }
  vendorsResponsesTable(): Locator { return this.page.getByTestId('sourcing-vendors-responses-table'); }
  publishedDocExport(): Locator { return this.page.getByTestId('sourcing-published-document-export-button'); }

  async clickEdit(): Promise<void> {
    await this.editButton().click();
    await expect(this.page).toHaveURL(/\/sourcing\/[^/]+\/edit(\b|$|\?)/);
  }
}
