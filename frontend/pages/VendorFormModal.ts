/**
 * Page Object — the shared Vendor create/edit modal (CEIQ-FEAT-005 §11.3),
 * VERIFIED against the built tenant app (dev). Create and Edit render the SAME
 * VendorFormFields with a different testid prefix, so one POM drives both:
 *   new VendorFormModal(page, 'create')  → Add vendor modal
 *   new VendorFormModal(page, 'edit')    → Edit vendor modal
 *
 * Field validation errors are plain Typography.Text[type=danger] rendered directly
 * under the field (NOT antd Form.Item explain), so they are matched by their
 * verbatim text (which is unique per rule). Explicit / web-first waits only.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { VendorLocators as L, type VendorFormPrefix } from '../locators/vendors';
import { VendorCopy } from '../tests/fixtures/expectedCopyVendors';

export interface VendorFormValues {
  name?: string;
  primaryCategory?: string;
  subcategory?: string;
  website?: string;
  notes?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
}

export class VendorFormModal {
  readonly prefix: VendorFormPrefix;
  readonly isEdit: boolean;

  constructor(readonly page: Page, mode: 'create' | 'edit') {
    this.isEdit = mode === 'edit';
    this.prefix = mode === 'edit' ? L.editFormPrefix : L.createFormPrefix;
  }

  // ------------------------------------------------------------------ modal
  /**
   * antd puts the data-testid on the OUTER `.ant-modal-root` wrapper, which has a
   * zero-size bounding box → Playwright reports it "hidden" even when the dialog
   * is open. Scope to the inner `.ant-modal` panel: it carries the visible box,
   * still contains the title/fields/footer buttons, and goes hidden on close.
   */
  get modal(): Locator {
    return this.page
      .getByTestId(this.isEdit ? L.editModal : L.createModal)
      .locator('.ant-modal')
      .first();
  }
  get saveButton(): Locator {
    return this.page.getByTestId(this.isEdit ? L.editModalSave : L.createModalSave);
  }
  get cancelButton(): Locator {
    return this.page.getByTestId(this.isEdit ? L.editModalCancel : L.createModalCancel);
  }
  get deleteButton(): Locator {
    return this.page.getByTestId(L.editModalDelete);
  }

  async expectOpen(): Promise<void> {
    await expect(this.modal).toBeVisible();
  }

  // ------------------------------------------------------------------ fields
  get nameInput(): Locator {
    return this.page.getByTestId(L.formName(this.prefix));
  }
  get primaryCategory(): Locator {
    return this.page.getByTestId(L.formPrimaryCategory(this.prefix));
  }
  get subcategory(): Locator {
    return this.page.getByTestId(L.formSubcategory(this.prefix));
  }
  get primaryContactName(): Locator {
    return this.page.getByTestId(L.formPrimaryContactName(this.prefix));
  }
  get primaryContactEmail(): Locator {
    return this.page.getByTestId(L.formPrimaryContactEmail(this.prefix));
  }
  get primaryContactPhone(): Locator {
    return this.page.getByTestId(L.formPrimaryContactPhone(this.prefix));
  }
  get secondaryExpandButton(): Locator {
    return this.page.getByTestId(L.formSecondaryExpand(this.prefix));
  }
  get secondaryCollapseButton(): Locator {
    return this.page.getByTestId(L.formSecondaryCollapse(this.prefix));
  }
  get secondaryNameInput(): Locator {
    return this.page.getByTestId(L.formSecondaryName(this.prefix));
  }
  /** The 5 primary-contact address sub-field inputs (order = canonical). */
  get primaryAddressInputs(): Locator[] {
    return [
      this.page.getByTestId(L.formPrimaryAddressStreet(this.prefix)),
      this.page.getByTestId(L.formPrimaryAddressLine2(this.prefix)),
      this.page.getByTestId(L.formPrimaryAddressCity(this.prefix)),
      this.page.getByTestId(L.formPrimaryAddressState(this.prefix)),
      this.page.getByTestId(L.formPrimaryAddressZip(this.prefix)),
    ];
  }

  // ------------------------------------------------------------- interactions
  private async setInput(locator: Locator, value: string): Promise<void> {
    await locator.fill('');
    if (value) await locator.fill(value);
  }

  /** Select an antd Select option by its visible label (option list is a portal). */
  private async pickOption(select: Locator, label: string): Promise<void> {
    await select.click();
    const option = this.page.locator(L.selectOption, { hasText: label }).first();
    await option.click();
    // antd closes the option list asynchronously; wait for it so a lingering
    // overlay can't intercept the next select's open-click (flake seen on
    // throttled dev when picking primary category then subcategory back-to-back).
    await expect(option).toBeHidden();
  }

  async selectPrimaryCategory(label: string): Promise<void> {
    await this.pickOption(this.primaryCategory, label);
  }
  async selectSubcategory(label: string): Promise<void> {
    await this.pickOption(this.subcategory, label);
  }

  /** Fill the provided subset of fields (leaves the rest untouched). */
  async fill(values: VendorFormValues): Promise<void> {
    if (values.name !== undefined) await this.setInput(this.nameInput, values.name);
    if (values.primaryCategory) await this.selectPrimaryCategory(values.primaryCategory);
    if (values.subcategory) await this.selectSubcategory(values.subcategory);
    if (values.website !== undefined)
      await this.setInput(this.page.getByTestId(L.formWebsite(this.prefix)), values.website);
    if (values.notes !== undefined)
      await this.setInput(this.page.getByTestId(L.formNotes(this.prefix)), values.notes);
    if (values.primaryContactName !== undefined)
      await this.setInput(this.primaryContactName, values.primaryContactName);
    if (values.primaryContactEmail !== undefined)
      await this.setInput(this.primaryContactEmail, values.primaryContactEmail);
    if (values.primaryContactPhone !== undefined)
      await this.setInput(this.primaryContactPhone, values.primaryContactPhone);
  }

  async submit(): Promise<void> {
    await this.saveButton.click();
  }
  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  /**
   * Submit and await the create/update network commit. Returns the response
   * status. Method is POST for create, PATCH/PUT for edit.
   */
  async submitAndWait(): Promise<number> {
    const method = this.isEdit ? /^(PATCH|PUT)$/ : /^POST$/;
    const [resp] = await Promise.all([
      this.page.waitForResponse(
        (r) => /\/api\/v1\/vendors(\/[^/]+)?(\?|$)/.test(r.url()) && method.test(r.request().method()),
        { timeout: 30000 },
      ),
      this.submit(),
    ]);
    return resp.status();
  }

  // ------------------------------------------------------------- delete (edit)
  /** The delete Popconfirm's confirm button ("Delete"). */
  get deleteConfirmOk(): Locator {
    return this.page
      .locator(L.popconfirm)
      .getByRole('button', { name: VendorCopy.deleteConfirmOk })
      .last();
  }
  async openDeleteConfirm(): Promise<void> {
    await this.deleteButton.click();
    await expect(this.page.getByText(VendorCopy.deleteConfirmBody)).toBeVisible();
  }
  async confirmDelete(): Promise<void> {
    await this.deleteConfirmOk.click();
  }

  // ----------------------------------------------------------------- errors
  /** A verbatim validation message currently visible inside the modal. */
  message(text: string): Locator {
    return this.modal.getByText(text);
  }
  async expectFieldError(text: string): Promise<void> {
    await expect(this.message(text).first()).toBeVisible();
  }
  /** Count of "This field is required." messages currently shown. */
  async requiredCount(): Promise<number> {
    return this.message(VendorCopy.requiredField).count();
  }
}
