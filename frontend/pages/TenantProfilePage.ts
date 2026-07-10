/**
 * Page Object — Tenant Profile overlay (US-2.3 edit, US-2.2 toggle,
 * US-4.1 setup password/banner, US-4.2 handover).
 * Locators: locators/tenantProfile.ts (§6 placeholder contract).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TenantListLocators } from '../locators/tenantList';
import { TenantProfileLocators } from '../locators/tenantProfile';
import { AdminApiPaths } from '../utils/apiPaths';
import { ConfirmDialog } from '../utils/dialog';
import { delayApiResponse } from '../utils/network';
import { expectToast, expectToastVisible } from '../utils/toast';

interface ClickOptions {
  /** Deliberate attempt on a disabled control (e.g. locked Setup toggle). */
  force?: boolean;
}

export class TenantProfilePage {
  readonly page: Page;
  readonly dialog: ConfirmDialog;

  constructor(page: Page) {
    this.page = page;
    this.dialog = new ConfirmDialog(page);
  }

  // ---------------------------------------------------------------- locators

  get companySection(): Locator {
    return this.page.getByTestId(TenantProfileLocators.companySection);
  }

  get ownerSection(): Locator {
    return this.page.getByTestId(TenantProfileLocators.ownerSection);
  }

  get statusToggle(): Locator {
    return this.page.getByTestId(TenantProfileLocators.statusToggle);
  }

  get statusLabel(): Locator {
    return this.page.getByTestId(TenantProfileLocators.statusLabel);
  }

  get setupPassword(): Locator {
    return this.page.getByTestId(TenantProfileLocators.setupPassword);
  }

  get setupPasswordToggle(): Locator {
    return this.page.getByTestId(TenantProfileLocators.setupPasswordToggle);
  }

  get setupBanner(): Locator {
    return this.page.getByTestId(TenantProfileLocators.setupBanner);
  }

  get handoverButton(): Locator {
    return this.page.getByRole('button', { name: TenantProfileLocators.handoverButtonName });
  }

  get badge(): Locator {
    return this.page.getByTestId(TenantProfileLocators.profileBadge);
  }

  // ------------------------------------------------------------- open/close

  async expectOpen(): Promise<void> {
    await expect(this.companySection, 'Company section visible').toBeVisible();
    await expect(this.ownerSection, 'Procurement Owner section visible').toBeVisible();
  }

  async closeProfile(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.closeButton).click();
  }

  async expectClosed(): Promise<void> {
    await expect(this.companySection).toHaveCount(0);
  }

  // --------------------------------------------------------- company section

  async editCompanySection(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.companyEditButton).click();
  }

  async saveCompanySection(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.companySaveButton).click();
  }

  /** Save + assert the §10 pending state during the call (TC-ADMUX-002 2b). */
  async saveCompanySectionExpectingPending(): Promise<void> {
    const saveButton = this.page.getByTestId(TenantProfileLocators.companySaveButton);
    await saveButton.click();
    await expect(saveButton, 'Save disabled while the call is in flight').toBeDisabled();
    await expect(
      this.page.getByTestId(TenantListLocators.loadingIndicator),
      'loading indicator visible during the call',
    ).toBeVisible();
  }

  async cancelCompanySection(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.companyCancelButton).click();
  }

  async expectCompanySectionReadOnly(): Promise<void> {
    await expect(this.page.getByTestId(TenantProfileLocators.companySaveButton)).toHaveCount(0);
    await expect(this.page.getByTestId(TenantProfileLocators.companyEditButton)).toBeVisible();
  }

  async expectCompanySectionEditing(): Promise<void> {
    await expect(this.page.getByTestId(TenantProfileLocators.companySaveButton)).toBeVisible();
    await expect(this.page.getByTestId(TenantProfileLocators.companyCancelButton)).toBeVisible();
  }

  /** Clear-before-fill (automation-architecture §2). */
  async fillCompanyName(value: string): Promise<void> {
    const input = this.page.getByTestId(TenantProfileLocators.companyNameInput);
    await input.clear();
    await input.fill(value);
  }

  async fillWebsiteUrl(value: string): Promise<void> {
    const input = this.page.getByTestId(TenantProfileLocators.websiteUrlInput);
    await input.clear();
    await input.fill(value);
  }

  async fillCompanyAddress(value: string): Promise<void> {
    const input = this.page.getByTestId(TenantProfileLocators.companyAddressInput);
    await input.clear();
    await input.fill(value);
  }

  async expectCompanyAddressValue(value: string): Promise<void> {
    await expect(this.page.getByTestId(TenantProfileLocators.companyAddressInput)).toHaveValue(value);
  }

  async expectCompanySectionContains(text: string): Promise<void> {
    await expect(this.companySection).toContainText(text);
  }

  async expectCompanySectionNotContains(text: string): Promise<void> {
    await expect(this.companySection).not.toContainText(text);
  }

  /**
   * Duplicate/validation error surfaced for a company-section save. The exact
   * presentation surface (inline vs toast) is not pinned by the spec — the
   * message copy itself is asserted verbatim within the section.
   */
  async expectCompanySectionError(message: string): Promise<void> {
    await expect(this.companySection, 'company section error copy').toContainText(message);
  }

  // ----------------------------------------------------------- owner section

  async editOwnerSection(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.ownerEditButton).click();
  }

  async saveOwnerSection(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.ownerSaveButton).click();
  }

  /** Save + assert the §10 pending state during the call (TC-ADMUX-002 2c). */
  async saveOwnerSectionExpectingPending(): Promise<void> {
    const saveButton = this.page.getByTestId(TenantProfileLocators.ownerSaveButton);
    await saveButton.click();
    await expect(saveButton, 'Save disabled while the call is in flight').toBeDisabled();
    await expect(
      this.page.getByTestId(TenantListLocators.loadingIndicator),
      'loading indicator visible during the call',
    ).toBeVisible();
  }

  async cancelOwnerSection(): Promise<void> {
    await this.page.getByTestId(TenantProfileLocators.ownerCancelButton).click();
  }

  async expectOwnerSectionReadOnly(): Promise<void> {
    await expect(this.page.getByTestId(TenantProfileLocators.ownerSaveButton)).toHaveCount(0);
    await expect(this.page.getByTestId(TenantProfileLocators.ownerEditButton)).toBeVisible();
  }

  async expectOwnerSectionEditing(): Promise<void> {
    await expect(this.page.getByTestId(TenantProfileLocators.ownerSaveButton)).toBeVisible();
    await expect(this.page.getByTestId(TenantProfileLocators.ownerCancelButton)).toBeVisible();
  }

  async fillOwnerName(value: string): Promise<void> {
    const input = this.page.getByTestId(TenantProfileLocators.ownerNameInput);
    await input.clear();
    await input.fill(value);
  }

  async fillOwnerEmail(value: string): Promise<void> {
    const input = this.page.getByTestId(TenantProfileLocators.ownerEmailInput);
    await input.clear();
    await input.fill(value);
  }

  async expectOwnerNameValue(value: string): Promise<void> {
    await expect(this.page.getByTestId(TenantProfileLocators.ownerNameInput)).toHaveValue(value);
  }

  async expectOwnerName(text: string): Promise<void> {
    await expect(this.ownerSection).toContainText(text);
  }

  async expectOwnerEmail(text: string): Promise<void> {
    await expect(this.ownerSection).toContainText(text);
  }

  async expectOwnerSectionNotContains(text: string): Promise<void> {
    await expect(this.ownerSection).not.toContainText(text);
  }

  /** See expectCompanySectionError — same presentation caveat. */
  async expectOwnerSectionError(message: string): Promise<void> {
    await expect(this.ownerSection, 'owner section error copy').toContainText(message);
  }

  // ------------------------------------------------------------------ status

  async toggleStatus(options: ClickOptions = {}): Promise<void> {
    await this.statusToggle.click({ force: options.force ?? false });
  }

  async expectToggleDisabled(): Promise<void> {
    await expect(this.statusToggle).toBeDisabled();
  }

  async expectToggleEnabled(): Promise<void> {
    await expect(this.statusToggle).toBeEnabled();
  }

  async expectStatusLabel(label: string): Promise<void> {
    await expect(this.statusLabel).toHaveText(label);
  }

  async expectStatusLabelNot(label: string): Promise<void> {
    await expect(this.statusLabel).not.toHaveText(label);
  }

  async statusLabelText(): Promise<string> {
    return (await this.statusLabel.innerText()).trim();
  }

  // -------------------------------------------------------- setup password

  async setupPasswordText(): Promise<string> {
    return (await this.setupPassword.innerText()).trim();
  }

  async expectSetupPasswordText(text: string): Promise<void> {
    await expect(this.setupPassword).toHaveText(text);
  }

  async expectSetupPasswordVisible(): Promise<void> {
    await expect(this.setupPassword).toBeVisible();
  }

  async expectSetupPasswordAbsent(): Promise<void> {
    await expect(this.setupPassword).toHaveCount(0);
  }

  async toggleSetupPasswordVisibility(): Promise<void> {
    await this.setupPasswordToggle.click();
  }

  /**
   * Deterministic reveal → read → re-mask cycle (leaves the display masked, the
   * state it started in). Avoids conditional is-it-revealed branching.
   */
  async revealAndReadSetupPassword(): Promise<string> {
    await this.toggleSetupPasswordVisibility();
    const value = await this.setupPasswordText();
    await this.toggleSetupPasswordVisibility();
    return value;
  }

  // ------------------------------------------------------------ setup banner

  /** Exact §8.6 banner copy (TC-ADMSETUP-002). */
  async expectSetupBanner(heading: string, body: string): Promise<void> {
    await expect(this.setupBanner).toBeVisible();
    await expect(this.setupBanner, 'banner heading copy').toContainText(heading);
    await expect(this.setupBanner, 'banner body copy').toContainText(body);
    await expect(
      this.setupBanner.getByRole('button', { name: TenantProfileLocators.handoverButtonName }),
      'banner action button',
    ).toBeVisible();
  }

  async expectSetupBannerAbsent(): Promise<void> {
    await expect(this.setupBanner).toHaveCount(0);
  }

  // ---------------------------------------------------------------- handover

  async clickHandover(): Promise<void> {
    await this.handoverButton.click();
  }

  /** Trigger handover and confirm the dialog (irreversible — disposable fixtures only). */
  async completeHandover(): Promise<void> {
    await this.clickHandover();
    await this.dialog.confirm();
  }

  async expectHandoverButtonVisible(): Promise<void> {
    await expect(this.handoverButton).toBeVisible();
  }

  async expectHandoverButtonAbsent(): Promise<void> {
    await expect(this.handoverButton).toHaveCount(0);
  }

  async expectBadge(text: string): Promise<void> {
    await expect(this.badge, 'profile handover-status badge').toHaveText(text);
  }

  /** Post-handover informational text in the PO section (US-4.2 AC). */
  async expectPostHandoverInfo(pattern: RegExp): Promise<void> {
    await expect(this.ownerSection, 'post-handover informational copy').toContainText(pattern);
  }

  async postHandoverInfoText(): Promise<string> {
    return (await this.ownerSection.innerText()).trim();
  }

  /**
   * [Date] in the post-handover text is the HANDOVER timestamp (TC-ADMHAND-004).
   * The rendered date format is not pinned by the spec — the extracted substring
   * is parsed with Date() and compared date-only against today.
   */
  async expectPostHandoverDateIsToday(): Promise<void> {
    const text = await this.postHandoverInfoText();
    const match = /Invite sent on (.+?)\./.exec(text);
    expect(match, `post-handover text carries a date ("${text}")`).not.toBeNull();
    const rendered = (match as RegExpExecArray)[1];
    const parsed = new Date(rendered);
    expect(Number.isNaN(parsed.getTime()), `date "${rendered}" is parseable`).toBe(false);
    expect(parsed.toDateString(), 'date equals the handover date (today)').toBe(new Date().toDateString());
  }

  // ------------------------------------------------------------------- toast

  async expectToast(text: string | RegExp): Promise<void> {
    await expectToast(this.page, text);
  }

  async expectToastVisible(): Promise<void> {
    await expectToastVisible(this.page);
  }

  // ------------------------------------------------------------------- mocks

  /** Delay PATCH …/company responses (TC-ADMUX-002 2b). Returns a restore function. */
  async delayCompanyResponse(delayMs: number): Promise<() => Promise<void>> {
    return delayApiResponse(this.page, AdminApiPaths.companySuffix, 'PATCH', delayMs);
  }

  /** Delay PATCH …/owner responses (TC-ADMUX-002 2c). Returns a restore function. */
  async delayOwnerResponse(delayMs: number): Promise<() => Promise<void>> {
    return delayApiResponse(this.page, AdminApiPaths.ownerSuffix, 'PATCH', delayMs);
  }
}
