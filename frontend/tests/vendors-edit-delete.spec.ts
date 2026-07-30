/**
 * CEIQ-FEAT-005 — Edit & Delete Vendor (US-VD-002/003, §11.3).
 * Source: testcases/TC-CEIQ-FEAT-005.md — TC-VDUI-015…025.
 *
 * Serial: a single probe vendor is created once (real POST), edited/inspected by
 * the read-write cases, and soft-deleted at the end. afterAll deletes it if any
 * test bailed before the delete case, so the shared dev tenant is left clean.
 *
 * Delete-BLOCKED cases (active contracts / open sourcing participation) are
 * skipped — they need the Contracts + Sourcing modules seeded, which are stubbed
 * this cycle (readiness report blockers #4/#5).
 */
import { test, expect } from '@playwright/test';
import { VendorDirectoryPage } from '../pages/VendorDirectoryPage';
import { VendorFormModal } from '../pages/VendorFormModal';
import { VendorProfilePage } from '../pages/VendorProfilePage';
import { VendorCopy } from './fixtures/expectedCopyVendors';

test.describe.serial('US-VD-002/003 Edit & Delete Vendor', () => {
  const baseName = `EditDelete Probe ${Date.now().toString(36)}`;
  let vendorName = baseName;
  let deleted = false;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: 'playwright/.auth/po.json' });
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');
    await directory.goto();
    await directory.openCreate();
    await form.fill({
      name: baseName,
      primaryCategory: VendorCopy.category.technology,
      subcategory: VendorCopy.category.technologySub,
      primaryContactName: 'Probe Owner',
      primaryContactEmail: 'probe@editdelete.test',
      primaryContactPhone: '+16502530000',
    });
    const status = await form.submitAndWait();
    expect(status).toBe(201);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (deleted) return;
    const page = await browser.newPage({ storageState: 'playwright/.auth/po.json' });
    try {
      const directory = new VendorDirectoryPage(page);
      const profile = new VendorProfilePage(page);
      const form = new VendorFormModal(page, 'edit');
      await directory.goto();
      await directory.search(vendorName);
      if ((await directory.rowByName(vendorName).count()) > 0) {
        await directory.openProfileByName(vendorName);
        await profile.openEdit();
        await form.openDeleteConfirm();
        await form.confirmDelete();
      }
    } finally {
      await page.close();
    }
  });

  test('TC-VDUI-015 Edit opens the modal pre-populated with current values @smoke @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    const form = new VendorFormModal(page, 'edit');

    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.openEdit();

    await expect(form.modal).toContainText(VendorCopy.editModalTitle);
    await expect(form.nameInput).toHaveValue(vendorName);
    await expect(form.primaryContactEmail).toHaveValue('probe@editdelete.test');
    await form.cancel();
  });

  test('TC-VDUI-016 Edit enforces mandatory fields (clearing name blocks save) @smoke @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    const form = new VendorFormModal(page, 'edit');

    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.openEdit();

    await form.nameInput.fill(''); // clear the mandatory name
    await form.submit();
    await form.expectFieldError(VendorCopy.requiredField);
    await expect(form.modal).toBeVisible(); // stays open, not saved
    await form.cancel();
  });

  test('TC-VDUI-017 Edit saves changes; profile reflects the updated value @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    const form = new VendorFormModal(page, 'edit');
    const updatedName = `${baseName} v2`;

    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.openEdit();

    await form.fill({ name: updatedName });
    const status = await form.submitAndWait();
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    vendorName = updatedName; // keep cleanup/subsequent lookups aligned

    await expect(profile.header).toContainText(updatedName);
  });

  test('TC-VDUI-018 Cancelling edit discards unsaved changes @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    const form = new VendorFormModal(page, 'edit');

    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.openEdit();

    await form.fill({ name: `${vendorName} DISCARDED` });
    await form.cancel();
    await expect(form.modal).toBeHidden();
    await expect(profile.header).not.toContainText('DISCARDED');
  });

  test('TC-VDUI-020 Delete button in edit footer opens confirmation with exact copy @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    const form = new VendorFormModal(page, 'edit');

    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.openEdit();

    await expect(form.deleteButton).toBeVisible();
    await form.openDeleteConfirm();
    await expect(page.getByText(VendorCopy.deleteConfirmBody)).toBeVisible();
    await expect(form.deleteConfirmOk).toBeVisible();
  });

  test('TC-VDUI-021 Confirmed deletion soft-deletes, toasts "Vendor deleted.", redirects to directory @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    const form = new VendorFormModal(page, 'edit');

    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.openEdit();
    await form.openDeleteConfirm();
    await form.confirmDelete();

    await directory.expectToast(VendorCopy.vendorDeletedToast);
    await page.waitForURL(/\/vendors(\?|#|$)/, { timeout: 30000 });
    deleted = true;
  });

  test.skip('TC-VDUI-022 Delete disabled with tooltip when vendor has active contracts [blocked: Contracts module stubbed]', () => {});
  test.skip('TC-VDUI-023 Delete disabled with tooltip when vendor has open sourcing participation [blocked: Sourcing module stubbed]', () => {});
  test.skip('TC-VDUI-024 Blocker precedence: both blockers → active-contracts tooltip first [blocked: Contracts + Sourcing stubbed]', () => {});
});
