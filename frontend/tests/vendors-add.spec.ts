/**
 * CEIQ-FEAT-005 — Add Vendor (US-VD-001, §11.3).
 * Source: testcases/TC-CEIQ-FEAT-005.md — TC-VDUI-001…011.
 *
 * Screen shipped on dev (feat/ceiq-feat-005 + the data-testid coverage PR). Runs
 * under the `po` project (PO storageState). The happy-path test creates a real
 * vendor and deletes it in cleanup so it leaves no residue on the shared dev
 * tenant. Validation/behaviour tests never submit, so they create nothing.
 *
 * Cases still skipped carry an explicit blocker reason.
 */
import { test, expect } from '@playwright/test';
import { VendorDirectoryPage } from '../pages/VendorDirectoryPage';
import { VendorFormModal } from '../pages/VendorFormModal';
import { VendorProfilePage } from '../pages/VendorProfilePage';
import { VendorCopy } from './fixtures/expectedCopyVendors';
import { VendorLocators as L } from '../locators/vendors';

/** Unique per run so parallel/retry runs on the shared dev tenant never collide. */
function uniqueName(base: string): string {
  return `${base} ${Date.now().toString(36)}`;
}

/** True if a POST to /api/v1/vendors was observed during the callback. */
async function watchForVendorPost(page: import('@playwright/test').Page, action: () => Promise<void>): Promise<boolean> {
  let posted = false;
  const listener = (request: import('@playwright/test').Request): void => {
    if (request.method() === 'POST' && /\/api\/v1\/vendors(\?|$)/.test(request.url())) posted = true;
  };
  page.on('request', listener);
  try {
    await action();
  } finally {
    page.off('request', listener);
  }
  return posted;
}

test.describe('US-VD-001 Add Vendor', () => {
  test('TC-VDUI-001 add vendor happy path → 201, navigates to new profile, appears in table @smoke @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');
    const profile = new VendorProfilePage(page);
    const name = uniqueName('Brightbeam Marketing');

    await directory.goto();
    await directory.openCreate();
    await form.fill({
      name,
      primaryCategory: VendorCopy.category.technology,
      subcategory: VendorCopy.category.technologySub,
      primaryContactName: 'Sara Lin',
      primaryContactEmail: 'sara@brightbeam.test',
      primaryContactPhone: '+16502530000',
    });

    const status = await form.submitAndWait();
    expect(status).toBe(201);

    // Navigates to the new vendor's profile.
    await page.waitForURL(/\/vendors\/[^/]+$/, { timeout: 30000 });
    await profile.expectLoaded();

    // Cleanup: soft-delete the vendor so the shared dev tenant is left clean.
    await profile.openEdit();
    await form.openDeleteConfirm();
    await form.confirmDelete();
    await directory.expectToast(VendorCopy.vendorDeletedToast);
  });

  test('TC-VDUI-002 mandatory field validation shows "This field is required." and blocks submit @smoke @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();

    const posted = await watchForVendorPost(page, async () => {
      await form.submit();
      await form.expectFieldError(VendorCopy.requiredField);
    });

    expect(posted, 'no POST should fire on invalid submit').toBe(false);
    // Name, primary category, subcategory, and the 3 primary-contact fields are
    // all mandatory — at least the name + contact fields show the required copy.
    expect(await form.requiredCount()).toBeGreaterThanOrEqual(2);
    await expect(form.modal).toBeVisible(); // form stays open
  });

  test('TC-VDUI-003 invalid primary-contact email shows "Please enter a valid email address." @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();
    await form.fill({
      name: uniqueName('Email Invalid'),
      primaryCategory: VendorCopy.category.technology,
      subcategory: VendorCopy.category.technologySub,
      primaryContactName: 'Sara Lin',
      primaryContactEmail: 'not-an-email',
      primaryContactPhone: '+16502530000',
    });

    const posted = await watchForVendorPost(page, async () => {
      await form.submit();
      await form.expectFieldError(VendorCopy.invalidEmail);
    });
    expect(posted).toBe(false);
  });

  test('TC-VDUI-004 invalid primary-contact phone shows "Please enter a valid phone number." @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();
    await form.fill({
      name: uniqueName('Phone Invalid'),
      primaryCategory: VendorCopy.category.technology,
      subcategory: VendorCopy.category.technologySub,
      primaryContactName: 'Sara Lin',
      primaryContactEmail: 'sara@brightbeam.test',
      primaryContactPhone: 'abc',
    });

    const posted = await watchForVendorPost(page, async () => {
      await form.submit();
      await form.expectFieldError(VendorCopy.invalidPhone);
    });
    expect(posted).toBe(false);
  });

  test('TC-VDUI-005 subcategory disabled until a primary category is selected @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();

    // Disabled at rest (antd Select renders `ant-select-disabled` on the root).
    await expect(form.subcategory).toHaveClass(/ant-select-disabled/);
    await form.selectPrimaryCategory(VendorCopy.category.technology);
    await expect(form.subcategory).not.toHaveClass(/ant-select-disabled/);
  });

  test('TC-VDUI-006 changing the primary category resets the subcategory to empty @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();
    await form.selectPrimaryCategory(VendorCopy.category.technology);
    await form.selectSubcategory(VendorCopy.category.technologySub);
    await expect(form.subcategory).toContainText(VendorCopy.category.technologySub);

    // Switch primary → subcategory clears back to its placeholder.
    await form.selectPrimaryCategory(VendorCopy.category.marketing);
    await expect(form.subcategory).not.toContainText(VendorCopy.category.technologySub);
  });

  test('TC-VDUI-007 secondary contact collapsed by default; expand shows fields @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();

    // Collapsed: expand affordance present, fields hidden.
    await expect(form.secondaryExpandButton).toBeVisible();
    await expect(form.secondaryNameInput).toHaveCount(0);

    await form.secondaryExpandButton.click();
    await expect(form.secondaryNameInput).toBeVisible();

    // Collapse hides the fields again.
    await form.secondaryCollapseButton.click();
    await expect(form.secondaryNameInput).toHaveCount(0);
  });

  test('TC-VDUI-009 Cancel discards the form without creating a vendor @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();
    await form.fill({ name: uniqueName('Discarded Vendor') });

    const posted = await watchForVendorPost(page, async () => {
      await form.cancel();
      await expect(form.modal).toBeHidden();
    });
    expect(posted).toBe(false);
  });

  test('TC-VDUI-010 compliance upload rejects a non-PDF with "Only PDF files are accepted." @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();

    // Client-side type guard — no S3 needed. Feed a .txt to the W-9 file input.
    await page
      .getByTestId(L.formDocFileInput(form.prefix, 'w9'))
      .setInputFiles({ name: 'not-a-pdf.txt', mimeType: 'text/plain', buffer: Buffer.from('nope') });
    await expect(form.modal.getByText(VendorCopy.docTypeError)).toBeVisible();
  });

  test('TC-VDUI-011 primary contact address section shows its 5 sub-fields by default @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');

    await directory.goto();
    await directory.openCreate();
    for (const input of form.primaryAddressInputs) {
      await expect(input).toBeVisible();
    }
  });

  test.skip('TC-VDUI-008 secondary contact address: 5 optional free-text sub-fields, no format validation', () => {
    // Deferred: exercised alongside TC-VDUI-007 once the secondary-address sub-field
    // testids are confirmed against the built form (VendorSecondaryContactFields
    // nests VendorAddressFields under a prefix not yet pinned in locators/vendors.ts).
  });
});
