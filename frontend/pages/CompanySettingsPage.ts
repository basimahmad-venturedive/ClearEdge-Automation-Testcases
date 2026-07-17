/**
 * Page Object — Company Settings screen (CEIQ-FEAT-004 §5).
 * Locators: locators/companySettings.ts (proposed contract).
 * Copy: tests/fixtures/expectedCopyCompanySettings.ts (spec-pinned, verbatim).
 *
 * Self-contained: construct with `new CompanySettingsPage(page)`. Explicit /
 * web-first waits only (no sleeps). Clear-before-input on the textarea.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { CompanySettingsLocators as L, type SectionKey } from '../locators/companySettings';
import { CsCopy } from '../tests/fixtures/expectedCopyCompanySettings';
import { AppRoutes } from '../utils/routes';

export class CompanySettingsPage {
  constructor(readonly page: Page) {}

  // ---------------------------------------------------------------- navigation
  async goto(): Promise<void> {
    await this.page.goto(AppRoutes.companySettings);
    await expect(this.page.getByRole('heading', { name: CsCopy.pageHeading, exact: true })).toBeVisible();
  }

  async openAccountMenu(): Promise<void> {
    await this.page.getByTestId(L.accountMenuTrigger).click();
  }

  /** The "Company Settings" dropdown item (Owner-only). */
  get menuItem(): Locator {
    return this.page.getByRole('menuitem', { name: L.menuItemName });
  }

  // ------------------------------------------------------------------ sections
  section(key: SectionKey): Locator {
    return this.page.getByTestId(L.sectionCard(key));
  }
  contentReadonly(key: SectionKey): Locator {
    return this.page.getByTestId(L.contentReadonly(key));
  }
  textarea(key: SectionKey): Locator {
    return this.page.getByTestId(L.textarea(key));
  }
  editButton(key: SectionKey): Locator {
    return this.section(key).getByRole('button', { name: L.editButtonName });
  }
  discardButton(key: SectionKey): Locator {
    return this.section(key).getByRole('button', { name: L.discardButtonName });
  }
  saveButton(key: SectionKey): Locator {
    return this.section(key).getByRole('button', { name: L.saveButtonName });
  }

  // --------------------------------------------------------------- interactions
  async enterEdit(key: SectionKey): Promise<void> {
    await this.editButton(key).click();
    await expect(this.textarea(key)).toBeEditable();
    await expect(this.discardButton(key)).toBeVisible();
  }

  /** Replace the textarea content (clear-before-input). */
  async type(key: SectionKey, text: string): Promise<void> {
    await this.textarea(key).fill(''); // clear-before-input (autofill / retained state)
    if (text) await this.textarea(key).fill(text);
  }

  async discard(key: SectionKey): Promise<void> {
    await this.discardButton(key).click();
    await expect(this.editButton(key)).toBeVisible();
  }

  async save(key: SectionKey): Promise<void> {
    await this.saveButton(key).click();
  }

  // ------------------------------------------------------------------- popup
  get popup(): Locator {
    return this.page.getByTestId(L.unsavedPopup);
  }
  get popupCancel(): Locator {
    return this.popup.getByRole('button', { name: L.popupCancelName });
  }
  get popupSaveChanges(): Locator {
    return this.popup.getByRole('button', { name: L.popupSaveChangesName });
  }

  // -------------------------------------------------------------- confirmation
  get confirmation(): Locator {
    return this.page.getByTestId(L.confirmation);
  }
  get genericError(): Locator {
    return this.page.getByTestId(L.error);
  }

  // ----------------------------------------------------------------- assertions
  async expectReadOnly(key: SectionKey): Promise<void> {
    await expect(this.editButton(key)).toBeEnabled();
    await expect(this.saveButton(key)).toBeDisabled();
    await expect(this.discardButton(key)).toHaveCount(0);
  }

  async expectSaveEnabled(key: SectionKey, enabled: boolean): Promise<void> {
    if (enabled) await expect(this.saveButton(key)).toBeEnabled();
    else await expect(this.saveButton(key)).toBeDisabled();
  }

  /** Count of sections currently in edit mode (exactly one at a time — BR-02). */
  async editingCount(): Promise<number> {
    return this.page.getByRole('button', { name: L.discardButtonName }).count();
  }
}
