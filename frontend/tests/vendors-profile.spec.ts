/**
 * CEIQ-FEAT-005 — Vendor profile page (US-VD-011/016/024, §11.4).
 * Source: testcases/TC-CEIQ-FEAT-005.md — TC-VDUI-055…069.
 *
 * Serial: one probe vendor created once and soft-deleted at the end. The profile
 * right column is a STACK of titled cards (Linked Contracts | History | Awarded
 * Opportunities), not Tabs.
 *
 * History/Awarded content, invite-to-sourcing, real compliance upload, and
 * cross-feature award blocking are skipped — they need the Sourcing/Contracts
 * modules and a live S3 bucket, all stubbed/absent this cycle (readiness
 * blockers #4/#5/#6).
 */
import { test, expect } from '@playwright/test';
import { VendorDirectoryPage } from '../pages/VendorDirectoryPage';
import { VendorFormModal } from '../pages/VendorFormModal';
import { VendorProfilePage } from '../pages/VendorProfilePage';
import { VendorCopy } from './fixtures/expectedCopyVendors';

test.describe.serial('US-VD Vendor profile', () => {
  const vendorName = `Profile Probe ${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: 'playwright/.auth/po.json' });
    const directory = new VendorDirectoryPage(page);
    const form = new VendorFormModal(page, 'create');
    await directory.goto();
    await directory.openCreate();
    await form.fill({
      name: vendorName,
      primaryCategory: VendorCopy.category.technology,
      subcategory: VendorCopy.category.technologySub,
      primaryContactName: 'Profile Owner',
      primaryContactEmail: 'owner@profile.test',
      primaryContactPhone: '+16502530000',
    });
    expect(await form.submitAndWait()).toBe(201);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
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

  async function openProfile(page: import('@playwright/test').Page): Promise<VendorProfilePage> {
    const directory = new VendorDirectoryPage(page);
    const profile = new VendorProfilePage(page);
    await directory.goto();
    await directory.search(vendorName);
    await directory.openProfileByName(vendorName);
    await profile.expectLoaded();
    return profile;
  }

  test('TC-VDUI-055 profile shows sidebar card + Linked Contracts / History / Awarded cards @smoke @regression', async ({
    page,
  }) => {
    const profile = await openProfile(page);
    await expect(profile.profileCard).toBeVisible();
    await expect(profile.contractsCard).toBeVisible();
    await expect(profile.historyCard).toBeVisible();
    await expect(profile.awardsCard).toBeVisible();
  });

  test('TC-VDUI-059 Previous Spend inline edit: "Not set" default, accepts a numeric amount @regression', async ({
    page,
  }) => {
    const profile = await openProfile(page);
    // Fresh vendor → no spend recorded.
    await expect(profile.profileCard).toContainText(VendorCopy.spendNotSet);

    // The field is an antd InputNumber with min=0, so negatives are blocked at the
    // widget (no separate error copy to assert). Verify a valid amount commits.
    await profile.enterSpendEdit();
    await profile.spendInput.fill('12000');
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => /\/api\/v1\/vendors\/[^/]+/.test(r.url()) && /^(PATCH|PUT)$/.test(r.request().method()),
        { timeout: 30000 },
      ),
      profile.spendSaveButton.click(),
    ]);
    expect(resp.status()).toBeGreaterThanOrEqual(200);
    expect(resp.status()).toBeLessThan(300);
  });

  test('TC-VDUI-064 status toggle on the profile uses the same confirmation @regression', async ({ page }) => {
    const profile = await openProfile(page);
    await profile.statusToggle.click();
    await profile.confirmDeactivate(); // asserts verbatim body + clicks "Mark as Inactive"
    // Reactivate — immediate, no modal — to leave the vendor Active for cleanup.
    // Assert on VISIBLE confirms only: the just-closed deactivate modal can linger in
    // the DOM through its leave-animation, so a bare count flakes (same fix as TC-VDUI-047).
    await profile.statusToggle.click();
    await expect(page.locator('.ant-modal-confirm:visible')).toHaveCount(0);
  });

  test.skip('TC-VDUI-056 History tab rows/ordering/withdrawn/awarded/empty [blocked: Sourcing history absent]', () => {});
  test.skip('TC-VDUI-057 History empty-state message [blocked: needs deterministic empty history]', () => {});
  test.skip('TC-VDUI-058 Awarded Opportunities entries/spend/sort/empty [blocked: Sourcing awards absent]', () => {});
  test.skip('TC-VDUI-060 Compliance View/Replace/Delete, independent W-9/COI [blocked: live S3 bucket absent]', () => {});
  test.skip('TC-VDUI-061 Invite modal Recommended + All Active sections [blocked: Sourcing module stubbed]', () => {});
  test.skip('TC-VDUI-062 Invite disabled on inactive vendor [blocked: Sourcing module stubbed]', () => {});
  test.skip('TC-VDUI-063 Invite modal with no active events [blocked: Sourcing module stubbed]', () => {});
  test.skip('TC-VDUI-065 Address display omits blank sub-fields [blocked: needs seeded address data]', () => {});
  test.skip('TC-VDUI-066 Inactive vendor cannot be awarded (Sourcing tab) [blocked: Sourcing screen not built]', () => {});
  test.skip('TC-VDUI-068 Invite modal no-match message [blocked: Sourcing module stubbed]', () => {});
});
