/**
 * Page Object — Tenant List screen (US-2.1) + card-level toggle (US-2.2).
 * Locators: locators/tenantList.ts (§6 placeholder contract).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TenantListLocators } from '../locators/tenantList';
import { AdminApiPaths } from '../utils/apiPaths';
import { ConfirmDialog } from '../utils/dialog';
import {
  delayApiResponse,
  mockApiFailure,
  trackApiRequests,
  trackRequests,
  type RequestCounter,
} from '../utils/network';
import { AppRoutes } from '../utils/routes';
import { expectToast, expectToastVisible } from '../utils/toast';

interface ClickOptions {
  /** Deliberate attempt on a disabled control (e.g. locked Setup toggle). */
  force?: boolean;
}

export class TenantListPage {
  readonly page: Page;
  readonly dialog: ConfirmDialog;

  constructor(page: Page) {
    this.page = page;
    this.dialog = new ConfirmDialog(page);
  }

  // ---------------------------------------------------------------- locators

  get cards(): Locator {
    return this.page.getByTestId(TenantListLocators.tenantCard);
  }

  get searchBar(): Locator {
    return this.page.getByTestId(TenantListLocators.searchBar);
  }

  get tenantCountElement(): Locator {
    return this.page.getByTestId(TenantListLocators.tenantCount);
  }

  get pagination(): Locator {
    return this.page.getByTestId(TenantListLocators.pagination);
  }

  get createTenantButton(): Locator {
    return this.page.getByRole('button', { name: TenantListLocators.createTenantButtonName });
  }

  get emptyState(): Locator {
    return this.page.getByTestId(TenantListLocators.emptyState);
  }

  cardByName(companyName: string): Locator {
    return this.cards.filter({ hasText: companyName });
  }

  // -------------------------------------------------------------- navigation

  async goto(): Promise<void> {
    await this.page.goto(AppRoutes.tenantList);
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.expectLanded();
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.page.setViewportSize({ width, height });
  }

  /** Landed on the Tenant List (URL + primary CTA present). */
  async expectLanded(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(AppRoutes.tenantList));
    await expect(this.createTenantButton, '"Create Tenant" button visible').toBeVisible();
  }

  /** Tenant grid OR the zero-tenants message is shown (TC-ADMLOGIN-001 step 4). */
  async expectGridOrEmptyStateVisible(): Promise<void> {
    await expect(this.cards.first().or(this.emptyState)).toBeVisible();
  }

  /** Protected content never rendered (TC-ADMLOGIN-007 while logged out). */
  async expectProtectedContentHidden(): Promise<void> {
    await expect(this.createTenantButton).toHaveCount(0);
    await expect(this.cards).toHaveCount(0);
  }

  // ------------------------------------------------------------------ search

  async searchTenants(text: string): Promise<void> {
    await this.searchBar.clear();
    await this.searchBar.fill(text);
  }

  async clearSearch(): Promise<void> {
    await this.searchBar.clear();
  }

  async expectNoMatchMessage(searchText: string): Promise<void> {
    // Exact copy per TC-ADMLIST-006 expected result (single-quoted search text).
    await expect(this.emptyState, 'empty-results copy').toHaveText(`No tenants match '${searchText}'.`);
  }

  async expectEmptyState(): Promise<void> {
    // Exact copy per US-2.1 Business Rule (TC-ADMLIST-007).
    await expect(this.emptyState, 'zero-tenants copy').toHaveText('No tenants yet.');
  }

  // ------------------------------------------------------------------- count

  async expectTenantCount(count: number): Promise<void> {
    await expect(this.tenantCountElement, 'running tenant count').toContainText(String(count));
  }

  /** Parse the numeric running total out of the count element. */
  async tenantCountValue(): Promise<number> {
    const text = await this.tenantCountElement.innerText();
    const match = /\d+/.exec(text);
    expect(match, `tenant count element renders a number (got "${text}")`).not.toBeNull();
    return Number(match?.[0]);
  }

  // -------------------------------------------------------------- pagination

  async goToPage(pageNumber: number): Promise<void> {
    await this.pagination.getByRole('button', { name: String(pageNumber) }).click();
  }

  /**
   * Active page indicator. TODO_LOCATOR: aria-current="page" is the proposed
   * convention — confirm with the frontend team.
   */
  async expectActivePage(pageNumber: number): Promise<void> {
    await expect(
      this.pagination.getByRole('button', { name: String(pageNumber) }),
    ).toHaveAttribute('aria-current', 'page');
  }

  async expectPaginationVisible(): Promise<void> {
    await expect(this.pagination).toBeVisible();
  }

  async expectPaginationHidden(): Promise<void> {
    await expect(this.pagination).toHaveCount(0);
  }

  // ------------------------------------------------------------------- cards

  async expectCardCount(count: number): Promise<void> {
    await expect(this.cards).toHaveCount(count);
  }

  async expectCardCountAtLeast(count: number): Promise<void> {
    const actual = await this.cards.count();
    expect(actual, `at least ${count} card(s) visible`).toBeGreaterThanOrEqual(count);
  }

  async firstCardName(): Promise<string> {
    return (await this.cards.first().getByTestId(TenantListLocators.cardCompanyName).innerText()).trim();
  }

  async lastCardName(): Promise<string> {
    return (await this.cards.last().getByTestId(TenantListLocators.cardCompanyName).innerText()).trim();
  }

  async expectFirstCard(companyName: string): Promise<void> {
    await expect(this.cards.first(), 'first card on page 1').toContainText(companyName);
  }

  async expectCardAt(index: number, companyName: string): Promise<void> {
    await expect(this.cards.nth(index)).toContainText(companyName);
  }

  async expectLastCard(companyName: string): Promise<void> {
    await expect(this.cards.last()).toContainText(companyName);
  }

  /** Every card element listed by TC-ADMLIST-001 (US-2.1 AC). */
  async expectCardCoreElements(companyName: string): Promise<void> {
    const card = this.cardByName(companyName);
    await expect(card.getByTestId(TenantListLocators.cardTenantId), 'tenant id (TEN####)').toHaveText(/^TEN\d{4,}$/);
    await expect(card.getByTestId(TenantListLocators.cardCompanyName)).toHaveText(companyName);
    await expect(card.getByTestId(TenantListLocators.cardWebsiteLink)).toBeVisible();
    await expect(card.getByTestId(TenantListLocators.cardAddress)).toBeVisible();
    await expect(card.getByTestId(TenantListLocators.cardOwnerName)).toBeVisible();
    await expect(card.getByTestId(TenantListLocators.cardOwnerEmail)).toBeVisible();
    await expect(card.getByTestId(TenantListLocators.cardStatusToggle)).toBeVisible();
    await expect(card.getByTestId(TenantListLocators.cardStatusLabel)).toBeVisible();
    await expect(card.getByRole('button', { name: TenantListLocators.cardEditButtonName })).toBeVisible();
  }

  async expectCardBadge(companyName: string, badgeText: string): Promise<void> {
    await expect(
      this.cardByName(companyName).getByTestId(TenantListLocators.cardBadge),
      'top-right handover-status badge',
    ).toHaveText(badgeText);
  }

  async expectCardStatusLabel(companyName: string, label: string): Promise<void> {
    await expect(
      this.cardByName(companyName).getByTestId(TenantListLocators.cardStatusLabel),
    ).toHaveText(label);
  }

  async cardStatusLabelText(companyName: string): Promise<string> {
    return (
      await this.cardByName(companyName).getByTestId(TenantListLocators.cardStatusLabel).innerText()
    ).trim();
  }

  async expectCardToggleDisabled(companyName: string): Promise<void> {
    await expect(
      this.cardByName(companyName).getByTestId(TenantListLocators.cardStatusToggle),
    ).toBeDisabled();
  }

  async expectCardOwnerName(companyName: string, ownerName: string): Promise<void> {
    await expect(
      this.cardByName(companyName).getByTestId(TenantListLocators.cardOwnerName),
    ).toHaveText(ownerName);
  }

  async expectCardOwnerEmailIsMailto(companyName: string, email: string): Promise<void> {
    await expect(
      this.cardByName(companyName).getByTestId(TenantListLocators.cardOwnerEmail),
    ).toHaveAttribute('href', `mailto:${email}`);
  }

  /** Click the card's website link and return the NEW TAB it opened. */
  async openCardWebsiteLink(companyName: string): Promise<Page> {
    const [popup] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.cardByName(companyName).getByTestId(TenantListLocators.cardWebsiteLink).click(),
    ]);
    return popup;
  }

  // ----------------------------------------------------------------- actions

  async openCreateTenant(): Promise<void> {
    await this.createTenantButton.click();
  }

  async expectCreateTenantEnabled(): Promise<void> {
    await expect(this.createTenantButton).toBeVisible();
    await expect(this.createTenantButton).toBeEnabled();
  }

  async openProfile(companyName: string): Promise<void> {
    await this.cardByName(companyName).click();
  }

  async clickCardEdit(companyName: string): Promise<void> {
    await this.cardByName(companyName)
      .getByRole('button', { name: TenantListLocators.cardEditButtonName })
      .click();
  }

  async clickCardToggle(companyName: string, options: ClickOptions = {}): Promise<void> {
    await this.cardByName(companyName)
      .getByTestId(TenantListLocators.cardStatusToggle)
      .click({ force: options.force ?? false });
  }

  /** Rapid repeated clicks (TC-ADMTOGGLE-005) — forced so an open dialog overlay cannot block them. */
  async clickCardToggleRapidly(companyName: string, times: number): Promise<void> {
    const toggle = this.cardByName(companyName).getByTestId(TenantListLocators.cardStatusToggle);
    for (let i = 0; i < times; i += 1) {
      await toggle.click({ force: true });
    }
  }

  // -------------------------------------------------------- responsive (011)

  private async cardBoundingBoxes(): Promise<Array<{ x: number; y: number }>> {
    const boxes: Array<{ x: number; y: number }> = [];
    for (const card of await this.cards.all()) {
      const box = await card.boundingBox();
      if (box) {
        boxes.push({ x: box.x, y: box.y });
      }
    }
    return boxes;
  }

  async expectMultiColumnLayout(): Promise<void> {
    const boxes = await this.cardBoundingBoxes();
    expect(boxes.length, 'cards rendered').toBeGreaterThanOrEqual(2);
    const firstRowY = Math.round(boxes[0].y);
    const cardsOnFirstRow = boxes.filter((box) => Math.round(box.y) === firstRowY);
    expect(cardsOnFirstRow.length, 'at least two cards share the first row on desktop').toBeGreaterThan(1);
  }

  async expectSingleColumnLayout(): Promise<void> {
    const boxes = await this.cardBoundingBoxes();
    expect(boxes.length, 'cards rendered').toBeGreaterThanOrEqual(2);
    const distinctRows = new Set(boxes.map((box) => Math.round(box.y)));
    expect(distinctRows.size, 'every card occupies its own row on mobile').toBe(boxes.length);
  }

  // ------------------------------------------------------------------- toast

  async expectToast(text: string | RegExp): Promise<void> {
    await expectToast(this.page, text);
  }

  async expectToastVisible(): Promise<void> {
    await expectToastVisible(this.page);
  }

  // -------------------------------------------------- network tracking/mocks

  trackTenantCreateRequests(): RequestCounter {
    return trackRequests(
      this.page,
      (request) =>
        request.method() === 'POST' &&
        request.url().includes(AdminApiPaths.tenants) &&
        !request.url().includes(AdminApiPaths.handoverSuffix),
    );
  }

  trackStatusPatchRequests(): RequestCounter {
    return trackApiRequests(this.page, 'PATCH', AdminApiPaths.statusSuffix);
  }

  trackCompanyPatchRequests(): RequestCounter {
    return trackApiRequests(this.page, 'PATCH', AdminApiPaths.companySuffix);
  }

  trackOwnerPatchRequests(): RequestCounter {
    return trackApiRequests(this.page, 'PATCH', AdminApiPaths.ownerSuffix);
  }

  trackAnyTenantPatchRequests(): RequestCounter {
    return trackApiRequests(this.page, 'PATCH', AdminApiPaths.tenants);
  }

  trackHandoverPostRequests(): RequestCounter {
    return trackApiRequests(this.page, 'POST', AdminApiPaths.handoverSuffix);
  }

  /** GET /api/v1/admin/tenants/:id (detail load — TC-ADMEDIT-001). */
  trackTenantDetailRequests(): RequestCounter {
    const detailPattern = new RegExp(`${AdminApiPaths.tenants.replace(/\//g, '\\/')}\\/[^/?]+(\\?.*)?$`);
    return trackRequests(
      this.page,
      (request) => request.method() === 'GET' && detailPattern.test(request.url()),
    );
  }

  /** Mock a PATCH /status failure (TC-ADMUX-001 1b). Returns a restore function. */
  async mockStatusFailure(kind: 'http-error' | 'abort'): Promise<() => Promise<void>> {
    return mockApiFailure(this.page, {
      urlFragment: AdminApiPaths.statusSuffix,
      method: 'PATCH',
      kind,
    });
  }

  /** Delay PATCH /status responses (TC-ADMUX-002 2a). Returns a restore function. */
  async delayStatusResponse(delayMs: number): Promise<() => Promise<void>> {
    return delayApiResponse(this.page, AdminApiPaths.statusSuffix, 'PATCH', delayMs);
  }
}
