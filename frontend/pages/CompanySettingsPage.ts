/**
 * Page Object — Company Settings screen (CEIQ-FEAT-004 §5), VERIFIED against the
 * built tenant app (dev, PR #26).
 * Locators: locators/companySettings.ts (real data-testids).
 * Copy: tests/fixtures/expectedCopyCompanySettings.ts (spec-pinned, verbatim).
 *
 * Construct with `new CompanySettingsPage(page)`. Explicit / web-first waits only
 * (no sleeps). Clear-before-input on the textarea.
 *
 * Navigation preserves the PO session: the tenant app guards routes client-side
 * with an in-memory session, so a hard `page.goto('/company-settings')` reloads
 * and bounces to the dashboard (same as User Management). We therefore navigate
 * via the avatar dropdown → "Company Settings" menu item instead. The `po`
 * project loads a saved storageState, so the app is already authenticated.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { CompanySettingsLocators as L, type SectionKey } from '../locators/companySettings';
import { CsCopy } from '../tests/fixtures/expectedCopyCompanySettings';
import { appBaseUrl } from '../utils/env';

export class CompanySettingsPage {
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
    // Full SPA boot (JS + auth rehydration + first API calls) on a throttled dev
    // can exceed 30s on a fresh per-test context; 45s keeps app-boot lag from
    // flaking the shell wait (retries then rarely need to kick in).
    await expect(this.page.getByTestId(L.view).or(this.page.locator('.ant-avatar')).first()).toBeVisible({
      timeout: 45000,
    });
  }

  /** Open the avatar dropdown that hosts the "Company Settings" item. */
  async openAccountMenu(): Promise<void> {
    await this.page.locator('.ant-avatar').first().click();
  }

  /** The "Company Settings" avatar-dropdown item (Owner-only). */
  get menuItem(): Locator {
    return this.page.getByRole('menuitem', { name: L.menuItemName });
  }

  /** Navigate to the screen via the nav (keeps the PO session alive). */
  async goto(): Promise<void> {
    if (!this.page.url().includes('/company-settings')) {
      await this.ensureInApp();
      await this.openAccountMenu();
      await this.menuItem.click();
    }
    await this.page.waitForURL(/\/company-settings$/, { timeout: 30000 });
    await expect(this.page.getByRole('heading', { name: CsCopy.pageHeading, exact: true })).toBeVisible();
  }

  // ------------------------------------------------------------------ sections
  section(key: SectionKey): Locator {
    return this.page.getByTestId(L.sectionCard(key));
  }
  /** antd Card title (`.ant-card-head-title`) — the section heading text. */
  sectionTitle(key: SectionKey): Locator {
    return this.section(key).locator(L.cardTitle);
  }
  contentReadonly(key: SectionKey): Locator {
    return this.page.getByTestId(L.contentReadonly(key));
  }
  textarea(key: SectionKey): Locator {
    return this.page.getByTestId(L.textarea(key));
  }
  editButton(key: SectionKey): Locator {
    return this.page.getByTestId(L.editButton(key));
  }
  discardButton(key: SectionKey): Locator {
    return this.page.getByTestId(L.discardButton(key));
  }
  saveButton(key: SectionKey): Locator {
    return this.page.getByTestId(L.saveButton(key));
  }

  // --------------------------------------------------------------- interactions
  async enterEdit(key: SectionKey): Promise<void> {
    await this.editButton(key).click();
    await expect(this.textarea(key)).toBeEditable();
    await expect(this.discardButton(key)).toBeVisible();
  }

  /** Current live baseline for a section (read-only rendered text). */
  async savedContent(key: SectionKey): Promise<string> {
    return (await this.contentReadonly(key).textContent())?.trim() ?? '';
  }

  /** The value currently in the (editable) textarea. */
  async draft(key: SectionKey): Promise<string> {
    return this.textarea(key).inputValue();
  }

  /** Replace the textarea content (clear-before-input). Empty string clears. */
  async type(key: SectionKey, text: string): Promise<void> {
    await this.textarea(key).fill(''); // clear-before-input (retained state)
    if (text) await this.textarea(key).fill(text);
  }

  async discard(key: SectionKey): Promise<void> {
    await this.discardButton(key).click();
    await expect(this.editButton(key)).toBeVisible();
  }

  async save(key: SectionKey): Promise<void> {
    await this.saveButton(key).click();
  }

  /** The section's PUT response predicate (real backend commit). */
  private isPutFor(key: SectionKey) {
    return (r: { url(): string; request(): { method(): string } }): boolean =>
      r.url().includes(`/company-settings/${key}`) && r.request().method() === 'PUT';
  }

  /** Set content and Save, awaiting the section PUT. Assumes edit mode is open. */
  async commitSave(key: SectionKey, content: string): Promise<number> {
    await this.type(key, content);
    const [resp] = await Promise.all([
      this.page.waitForResponse(this.isPutFor(key), { timeout: 30000 }),
      this.save(key),
    ]);
    return resp.status();
  }

  /**
   * Restore a section to `original` so a real-PUT test leaves no residue on the
   * shared dev tenant. Safe to call from a finally block in any state: it opens
   * edit if needed, and only PUTs when the live value actually differs.
   */
  async restore(key: SectionKey, original: string): Promise<void> {
    if ((await this.textarea(key).count()) === 0) {
      await this.editButton(key).click();
      await expect(this.textarea(key)).toBeEditable();
    }
    if ((await this.draft(key)) === original) {
      await this.discard(key);
      return;
    }
    await this.commitSave(key, original);
  }

  // ------------------------------------------------------------------- popup
  get popup(): Locator {
    return this.page.getByTestId(L.unsavedPopup);
  }
  get popupCancel(): Locator {
    return this.page.getByTestId(L.popupCancel);
  }
  get popupSaveChanges(): Locator {
    return this.page.getByTestId(L.popupSaveChanges);
  }

  // -------------------------------------------------------------- confirmation
  /** Save confirmation — antd notification (top-right); no testid. */
  get confirmation(): Locator {
    return this.page.locator(L.confirmationNotice).last();
  }
  get confirmationDismiss(): Locator {
    return this.confirmation.locator(L.confirmationClose);
  }
  /** Generic error on save failure — antd message; no testid. */
  get genericError(): Locator {
    return this.page.locator(L.messageNotice).last();
  }
  /** Per-section field validation error (antd Form.Item explain). */
  fieldError(key: SectionKey): Locator {
    return this.section(key).locator(L.fieldError);
  }

  // ----------------------------------------------------------------- assertions
  async expectReadOnly(key: SectionKey): Promise<void> {
    await expect(this.editButton(key)).toBeEnabled();
    await expect(this.saveButton(key)).toBeDisabled(); // Save present but disabled at rest
    await expect(this.textarea(key)).toHaveCount(0); // no editor when read-only
    await expect(this.discardButton(key)).toHaveCount(0);
    // Read-only content is rendered as a div; an unsaved (empty) section renders
    // an empty, zero-height div, so assert presence (attached), not visibility.
    await expect(this.contentReadonly(key)).toBeAttached();
  }

  async expectSaveEnabled(key: SectionKey, enabled: boolean): Promise<void> {
    if (enabled) await expect(this.saveButton(key)).toBeEnabled();
    else await expect(this.saveButton(key)).toBeDisabled();
  }

  /** Count of sections currently in edit mode (exactly one at a time — BR-02).
   *  A section is editing iff its textarea is present (read-only shows a div). */
  async editingCount(): Promise<number> {
    return this.page.getByTestId(/company-settings-section-.*-textarea/).count();
  }
}
