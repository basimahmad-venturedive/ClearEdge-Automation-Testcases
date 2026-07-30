/**
 * CEIQ-FEAT-005 — Vendor Overview: dataset-dependent cases (US-VD-005/024).
 * Source: testcases/TC-CEIQ-FEAT-005.md — TC-VDUI-038/039/040/042/043/044.
 *
 * These need a controlled MULTI-vendor dataset that the shared dev tenant does
 * not otherwise have. `VendorSeeder` creates 12 search-isolated vendors via the
 * API (`POST /v1/vendors`) in beforeAll and deletes them in afterAll, so the
 * assertions are deterministic and leave no residue. Two are starred to exercise
 * the Primary-only filter.
 *
 * Names are `${prefix} 01`…`12` (zero-padded) so name-sort order is predictable
 * and creation order (01 first → oldest) drives the Date-Added default sort.
 */
import { test, expect } from '@playwright/test';
import { VendorDirectoryPage } from '../pages/VendorDirectoryPage';
import { VendorSeeder, uniqueVendorPrefix, type SeededVendor } from '../utils/vendorApi';

test.describe.serial('US-VD-005/024 Vendor Overview — dataset-dependent', () => {
  const prefix = uniqueVendorPrefix('DataSet');
  let seeded: SeededVendor[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: 'playwright/.auth/po.json' });
    const request = page.request;
    const directory = new VendorDirectoryPage(page);
    await directory.goto(); // load the app so the Cognito token is in localStorage
    const seeder = new VendorSeeder(page, request);
    seeded = await seeder.seedVendors(12, prefix);
    // Star the first two so the Primary-only filter has a known subset.
    await seeder.setPrimary(seeded[0].id, true);
    await seeder.setPrimary(seeded[1].id, true);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: 'playwright/.auth/po.json' });
    try {
      const directory = new VendorDirectoryPage(page);
      await directory.goto();
      const seeder = new VendorSeeder(page, page.request);
      for (const vendor of seeded) {
        if (vendor.id) await seeder.deleteVendor(vendor.id);
      }
    } finally {
      await page.close();
    }
  });

  test('TC-VDUI-042 pagination: 10 per page, controls appear when >10, arrows disable at ends @smoke @regression', async ({
    page,
  }) => {
    const directory = new VendorDirectoryPage(page);
    await directory.goto();
    await directory.search(prefix); // isolates the 12 seeded vendors
    await expect(directory.pagination).toBeVisible();
    // Page 1: exactly 10 rows, prev disabled, next enabled.
    await expect.poll(() => directory.rows.count()).toBe(10);
    expect(await directory.isPrevDisabled()).toBe(true);
    expect(await directory.isNextDisabled()).toBe(false);
    // Page 2: the remaining 2 rows, next disabled.
    await directory.gotoNextPage();
    await expect.poll(() => directory.rows.count()).toBe(2);
    expect(await directory.isNextDisabled()).toBe(true);
  });

  test('TC-VDUI-043 page resets to 1 when the search changes @smoke @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    await directory.goto();
    await directory.search(prefix);
    await expect(directory.pagination).toBeVisible();
    await directory.gotoNextPage();
    await expect.poll(() => directory.rows.count()).toBe(2); // on page 2
    // Narrow the search → list changes → pager resets to page 1.
    await directory.search(`${prefix} 0`); // matches 01..09 (9 rows)
    await expect.poll(() => directory.rows.count()).toBe(9);
    // Page 1 semantics: prev disabled (we are back on the first page).
    if (await directory.pagination.isVisible()) {
      expect(await directory.isPrevDisabled()).toBe(true);
    }
  });

  test('TC-VDUI-044 no pagination controls when ≤10 vendors @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    await directory.goto();
    await directory.search(`${prefix} 0`); // 01..09 → 9 rows (≤10)
    await expect.poll(() => directory.rows.count()).toBe(9);
    await expect(directory.pagination).toHaveCount(0);
  });

  test('TC-VDUI-039 sort Vendor name A-Z then Z-A @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    await directory.goto();
    await directory.search(`${prefix} 0`); // 9 rows, single page — order is unambiguous
    await expect.poll(() => directory.rows.count()).toBe(9);

    await directory.sortByColumn('Vendor'); // ascending
    await expect.poll(() => directory.rows.count()).toBe(9); // re-fetch settles
    const asc = await directory.orderedVendorNames();
    expect(asc[0]).toBe(`${prefix} 01`);
    expect(asc[asc.length - 1]).toBe(`${prefix} 09`);

    await directory.sortByColumn('Vendor'); // toggle → descending
    await expect.poll(() => directory.rows.count()).toBe(9);
    // Re-read only once the leading row actually changed, to avoid a stale read.
    await expect.poll(async () => (await directory.orderedVendorNames())[0]).toBe(`${prefix} 09`);
    const desc = await directory.orderedVendorNames();
    expect(desc[desc.length - 1]).toBe(`${prefix} 01`);
  });

  test('TC-VDUI-040 default sort is Date Added descending; toggles oldest/newest @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    await directory.goto();
    await directory.search(`${prefix} 0`); // 9 rows, single page
    await expect.poll(() => directory.rows.count()).toBe(9);

    // Default sort = createdAt desc → newest first. 09 was created last of 01..09.
    const byDefault = await directory.orderedVendorNames();
    expect(byDefault[0]).toBe(`${prefix} 09`);

    // Toggle to ascending (oldest first → 01 leads). The Date Added column starts
    // in a controlled descending state, and antd's sort cycle is ascend→descend→
    // none, so reaching ascending can take more than one click — click until it
    // flips (bounded), then assert.
    for (let click = 0; click < 3; click += 1) {
      await directory.sortByColumn('Date Added');
      await expect.poll(() => directory.rows.count()).toBe(9);
      if ((await directory.orderedVendorNames())[0] === `${prefix} 01`) break;
    }
    await expect.poll(async () => (await directory.orderedVendorNames())[0]).toBe(`${prefix} 01`);
  });

  test('TC-VDUI-038 Primary Vendors toggle filter shows only starred vendors @regression', async ({ page }) => {
    const directory = new VendorDirectoryPage(page);
    await directory.goto();
    await directory.search(prefix); // all 12
    await directory.togglePrimaryOnly();
    // Only the two starred vendors (01, 02) remain.
    await expect.poll(() => directory.rows.count()).toBe(2);
    const names = await directory.orderedVendorNames();
    expect(names.sort()).toEqual([`${prefix} 01`, `${prefix} 02`]);
  });
});
