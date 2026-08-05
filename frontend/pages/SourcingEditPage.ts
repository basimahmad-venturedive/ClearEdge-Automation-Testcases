/**
 * Page Object — CEIQ-FEAT-007 draft edit screen (/sourcing/:id/edit). antd UI, real
 * testids. Read-only usage in the suite (assert structure + gate, never Save/Publish),
 * so it leaves no residue on the shared QA tenant.
 */
import { type Page, type Locator, expect } from '@playwright/test';

export const SourcingEditTestIds = {
  publishButton: 'sourcing-edit-publish-button',
  saveDraftButton: 'sourcing-edit-save-draft-button',
  cancelButton: 'sourcing-edit-cancel-button',
  detailsCard: 'sourcing-details-card',
  scopeTextarea: 'sourcing-scope-of-work-textarea',
  criteriaAddButton: 'sourcing-criteria-add-button',
  questionsCard: 'sourcing-vendor-questions-list-card',
  questionsAddButton: 'sourcing-vendor-questions-add-button',
} as const;

export class SourcingEditPage {
  constructor(private readonly page: Page) {}

  publishButton(): Locator { return this.page.getByTestId(SourcingEditTestIds.publishButton); }
  saveDraftButton(): Locator { return this.page.getByTestId(SourcingEditTestIds.saveDraftButton); }
  cancelButton(): Locator { return this.page.getByTestId(SourcingEditTestIds.cancelButton); }
  scopeTextarea(): Locator { return this.page.getByTestId(SourcingEditTestIds.scopeTextarea); }
  criteriaAddButton(): Locator { return this.page.getByTestId(SourcingEditTestIds.criteriaAddButton); }
  questionsAddButton(): Locator { return this.page.getByTestId(SourcingEditTestIds.questionsAddButton); }

  async expectLoaded(): Promise<void> {
    await expect(this.publishButton()).toBeVisible();
    await expect(this.saveDraftButton()).toBeVisible();
  }

  async cancel(): Promise<void> {
    await this.cancelButton().click();
    // Leaving the editor may raise an antd unsaved-changes confirm — accept it to proceed.
    const confirmLeave = this.page
      .locator('.ant-modal-confirm .ant-btn-primary, .ant-modal .ant-btn-dangerous, .ant-modal-confirm-btns button')
      .filter({ hasText: /discard|leave|yes|proceed|confirm|ok/i })
      .first();
    if (await confirmLeave.isVisible().catch(() => false)) {
      await confirmLeave.click();
    }
  }
}
