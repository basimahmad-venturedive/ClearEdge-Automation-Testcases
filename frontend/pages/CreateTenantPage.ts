/**
 * Page Object — Create Tenant form (US-3.1).
 * Locators: locators/createTenant.ts (§6 placeholder contract).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { CreateTenantLocators, type CreateField } from '../locators/createTenant';
import { AdminApiPaths } from '../utils/apiPaths';
import { mockApiFailure, trackRequests, type RequestCounter } from '../utils/network';
import { AppRoutes } from '../utils/routes';
import { TenantListLocators } from '../locators/tenantList';
import { expectToast } from '../utils/toast';

export interface TenantFormData {
  companyName: string;
  websiteUrl: string;
  companyAddress: string;
  ownerName: string;
  ownerEmail: string;
}

const FIELD_INPUT_TESTIDS: Record<CreateField, string> = {
  companyName: CreateTenantLocators.companyNameInput,
  websiteUrl: CreateTenantLocators.websiteUrlInput,
  companyAddress: CreateTenantLocators.companyAddressInput,
  ownerName: CreateTenantLocators.ownerNameInput,
  ownerEmail: CreateTenantLocators.ownerEmailInput,
};

const FIELD_ERROR_TESTIDS: Record<CreateField, string> = {
  companyName: CreateTenantLocators.companyNameError,
  websiteUrl: CreateTenantLocators.websiteUrlError,
  companyAddress: CreateTenantLocators.companyAddressError,
  ownerName: CreateTenantLocators.ownerNameError,
  ownerEmail: CreateTenantLocators.ownerEmailError,
};

export class CreateTenantPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  fieldInput(field: CreateField): Locator {
    return this.page.getByTestId(FIELD_INPUT_TESTIDS[field]);
  }

  fieldError(field: CreateField): Locator {
    return this.page.getByTestId(FIELD_ERROR_TESTIDS[field]);
  }

  get submitButton(): Locator {
    return this.page.getByRole('button', { name: CreateTenantLocators.submitButtonName });
  }

  get cancelButton(): Locator {
    return this.page.getByRole('button', { name: CreateTenantLocators.cancelButtonName });
  }

  async goto(): Promise<void> {
    await this.page.goto(AppRoutes.createTenant);
  }

  /** Clear-before-fill: sessions/autofill may retain values (automation-architecture §2). */
  async fillField(field: CreateField, value: string): Promise<void> {
    const input = this.fieldInput(field);
    await input.clear();
    await input.fill(value);
  }

  async blurField(field: CreateField): Promise<void> {
    await this.fieldInput(field).blur();
  }

  async fillForm(data: TenantFormData): Promise<void> {
    await this.fillField('companyName', data.companyName);
    await this.fillField('websiteUrl', data.websiteUrl);
    await this.fillField('companyAddress', data.companyAddress);
    await this.fillField('ownerName', data.ownerName);
    await this.fillField('ownerEmail', data.ownerEmail);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /** Two rapid clicks (TC-ADMCREATE-006 double-click prevention). */
  async doubleClickSubmit(): Promise<void> {
    await this.submitButton.dblclick();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  /** All five form fields visible (US-3.1 / TC-ADMLIST-010). */
  async expectFormVisible(): Promise<void> {
    await expect(this.fieldInput('companyName')).toBeVisible();
    await expect(this.fieldInput('websiteUrl')).toBeVisible();
    await expect(this.fieldInput('companyAddress')).toBeVisible();
    await expect(this.fieldInput('ownerName')).toBeVisible();
    await expect(this.fieldInput('ownerEmail')).toBeVisible();
  }

  /** Assert the inline error under a field shows the EXACT §5 copy. */
  async expectFieldError(field: CreateField, message: string): Promise<void> {
    await expect(this.fieldError(field), `${field} inline error copy`).toHaveText(message);
  }

  async expectNoFieldError(field: CreateField): Promise<void> {
    await expect(this.fieldError(field)).toHaveCount(0);
  }

  /** First invalid field scrolled into view on blocked submit (§5). */
  async expectFieldInViewport(field: CreateField): Promise<void> {
    await expect(this.fieldInput(field), `${field} brought into view`).toBeInViewport();
  }

  async expectSubmitEnabled(): Promise<void> {
    await expect(this.submitButton).toBeEnabled();
  }

  /** §10 pending state: button disabled + loading indicator during the call. */
  async expectSubmitDisabledWithLoading(): Promise<void> {
    await expect(this.submitButton, 'submit disabled while the call is in flight').toBeDisabled();
    await expect(
      this.page.getByTestId(TenantListLocators.loadingIndicator),
      'loading indicator visible during the call',
    ).toBeVisible();
  }

  async expectToast(text: string | RegExp): Promise<void> {
    await expectToast(this.page, text);
  }

  /** Count POST /api/v1/admin/tenants create calls. */
  trackCreateRequests(): RequestCounter {
    return trackRequests(
      this.page,
      (request) =>
        request.method() === 'POST' &&
        request.url().includes(AdminApiPaths.tenants) &&
        !request.url().includes(AdminApiPaths.handoverSuffix),
    );
  }

  /** Mock a POST /admin/tenants failure (TC-ADMUX-001 1a). Returns a restore function. */
  async mockCreateFailure(status: number): Promise<() => Promise<void>> {
    return mockApiFailure(this.page, {
      urlFragment: AdminApiPaths.tenants,
      method: 'POST',
      kind: 'http-error',
      status,
    });
  }
}
