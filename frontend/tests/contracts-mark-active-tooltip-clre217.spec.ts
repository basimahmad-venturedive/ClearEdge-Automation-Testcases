/**
 * CLRE-217 retest — the disabled "Mark as Active" tooltip must say WHY it is disabled.
 *
 * PM request (relates to CLRE-213/215/216, Contracts → Documents tab): the button showed
 * one generic string for every disabled reason. Requested behaviour:
 *
 *   already has an Active version  → "A version has already been marked as active."
 *   any other reason (no selection) → "Select one non-Active version to mark as Active."
 *
 * Both legs are asserted here, on the same contract, because the whole point of the
 * change is that the two cases are distinguishable — asserting only the new string would
 * still pass if the old one had simply been replaced everywhere.
 *
 * Fixtures — both branches need their own contract, and the finder prints candidates for
 * each:
 *   CLRE217_FAMILY_ID            a family that HAS an Active version
 *   CLRE217_NO_ACTIVE_FAMILY_ID  a family with versions but NO Active version
 *   cd automation/api-ts && TEST_ENV=qa npx tsx scripts/probe-find-active-family.ts
 *
 * Runs under the `po` project (Procurement Owner storageState); navigation goes through
 * the app origin (APP_BASE_URL), not the admin baseURL.
 */
import { test, expect, type Locator } from '@playwright/test';
import { appBaseUrl } from '../utils/env';
import { findFamilyWithActiveVersion, findFamilyWithoutActiveVersion } from '../utils/contractsApi';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;

const COPY = {
  alreadyActive: 'A version has already been marked as active.',
  selectOne: 'Select one non-Active version to mark as Active.',
} as const;

/**
 * Hover a disabled antd Button so its Tooltip opens.
 *
 * Verified against this build rather than assumed: antd does NOT wrap this disabled
 * button (its parent is the plain flex container) and leaves `pointer-events: auto` on
 * it, so the BUTTON is the trigger and hovering the parent does nothing. `force` is
 * needed only because Playwright's actionability check declines to hover a disabled
 * control. Note antd keeps the `.ant-tooltip` node in the DOM after the first hover, so
 * assertions must use `:visible` rather than presence.
 */
async function hoverDisabled(button: Locator): Promise<void> {
  await button.hover({ force: true });
}

test.describe('CLRE-217 — disabled "Mark as Active" tooltip distinguishes its reasons', () => {
  test('TC-CTUI-217 — tooltip names the real reason the button is disabled', async ({ page, request }) => {
    test.setTimeout(120_000);

    // The env var pins an exact family when a targeted re-test needs one; otherwise find a
    // family with an Active version at runtime. Gating the whole describe on an unset env var
    // meant this never ran in CI, which is how a CLRE regression guard silently stops guarding.
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });
    const familyId = process.env.CLRE217_FAMILY_ID?.trim() || (await findFamilyWithActiveVersion(page, request));
    expect(
      familyId,
      'no contract family with an Active version is reachable on this env — CLRE-217 cannot be evaluated',
    ).toBeTruthy();

    // Boot the SPA on the app origin so the persisted session rehydrates, then deep-link
    // (a cold goto straight to the detail route races the client-side auth guard).
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });
    await page.goto(appUrl(`/contracts/${familyId}`));

    const documentsTab = page.getByRole('tab', { name: /Documents/i });
    await expect(documentsTab).toBeVisible({ timeout: 45_000 });
    await documentsTab.click();

    const table = page.getByTestId('documents-tab-table');
    await expect(table).toBeVisible({ timeout: 30_000 });

    const markActive = page.getByTestId('documents-tab-mark-active-button');
    await expect(markActive).toBeVisible({ timeout: 30_000 });
    await expect(
      markActive,
      'fixture precondition: this family has an Active version, so the button must be disabled',
    ).toBeDisabled();

    // ── Leg 1 — nothing selected, and the family already has an Active version ─────────
    // Both disabled reasons are true at once here. The spec'd precedence is that the
    // Active-version reason wins, because it is the one the user cannot resolve by
    // selecting differently.
    await hoverDisabled(markActive);
    const tooltip = page.locator('.ant-tooltip:visible');
    await expect(tooltip, 'a disabled control must still explain itself').toBeVisible({ timeout: 15_000 });
    await expect(
      tooltip,
      'CLRE-217: with an Active version present the tooltip must name that reason, not ' +
      'tell the user to change a selection that cannot help.',
    ).toContainText(COPY.alreadyActive, { timeout: 10_000 });
    await expect(
      tooltip,
      'the generic selection copy must NOT be what is shown for this reason',
    ).not.toContainText(COPY.selectOne);

    // Selecting a row cannot enable the button while a version is Active, and the tooltip
    // must stay on the Active-version reason rather than reverting to the generic copy.
    const firstRowCheckbox = table.locator('tbody input[type="checkbox"]').first();
    if (await firstRowCheckbox.count()) {
      await firstRowCheckbox.check({ force: true });
      await page.mouse.move(0, 0);
      await hoverDisabled(markActive);
      await expect(page.locator('.ant-tooltip:visible')).toContainText(COPY.alreadyActive, { timeout: 10_000 });
      await expect(
        markActive,
        'spec: "only enabled when the contract has no Active version yet" — a selection ' +
        'must not enable it while a version is Active (the backend agrees, ERR_ALREADY_HAS_ACTIVE)',
      ).toBeDisabled();
    }
  });

  test('TC-CTUI-218 — with no Active version, the disabled tooltip keeps the generic selection copy', async ({ page, request }) => {
    test.setTimeout(120_000);

    // This is the half that proves the change DIFFERENTIATES rather than replaces: on a
    // family with no Active version and nothing selected, the original string must still
    // be the one shown.
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });
    const noActiveFamilyId =
      process.env.CLRE217_NO_ACTIVE_FAMILY_ID?.trim() || (await findFamilyWithoutActiveVersion(page, request));
    expect(
      noActiveFamilyId,
      'no family with saved versions but no Active version is reachable — the differentiation half is unevaluable',
    ).toBeTruthy();
    await page.goto(appUrl(`/contracts/${noActiveFamilyId}`));

    const documentsTab = page.getByRole('tab', { name: /Documents/i });
    await expect(documentsTab).toBeVisible({ timeout: 45_000 });
    await documentsTab.click();
    await expect(page.getByTestId('documents-tab-table')).toBeVisible({ timeout: 30_000 });

    const markActive = page.getByTestId('documents-tab-mark-active-button');
    await expect(markActive).toBeVisible({ timeout: 30_000 });
    await expect(
      markActive,
      'fixture precondition: nothing is selected yet, so the button must be disabled',
    ).toBeDisabled();

    await hoverDisabled(markActive);
    const tooltip = page.locator('.ant-tooltip:visible');
    await expect(tooltip).toBeVisible({ timeout: 15_000 });
    await expect(
      tooltip,
      'CLRE-217 must not collapse both reasons onto the new string either — with no ' +
      'Active version the actionable "select a version" guidance is the correct one.',
    ).toContainText(COPY.selectOne, { timeout: 10_000 });
    await expect(tooltip).not.toContainText(COPY.alreadyActive);
  });
});
