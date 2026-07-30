/**
 * CEIQ-FEAT-006 — Clause Configuration read-only view + edit-mode entry (US-CC-002, US-CC-003).
 * Source: testcases/TC-CEIQ-FEAT-006.md — CCUI-001…015, 020, 034, 037/038; CCACCESS-001.
 *
 * Runs under the `po` project (PO storageState). SIDE-EFFECT-FREE: this spec never
 * clicks Save Changes, so it never mutates the shared dev tenant's clause library
 * (Discard reverts in-memory only). Save/persistence cases live in a separate spec
 * that captures + restores a baseline via the API.
 */
import { test, expect } from '@playwright/test';
import { ClauseConfigurationPage } from '../pages/ClauseConfigurationPage';
import { ClauseCopy } from './fixtures/expectedCopyClause';
import { ClauseLocators as L } from '../locators/clauseConfiguration';

test.describe('Clause Configuration — read-only view (US-CC-002)', () => {
  let clause: ClauseConfigurationPage;

  test.beforeEach(async ({ page }) => {
    clause = new ClauseConfigurationPage(page);
    await clause.goto();
    await clause.expectLanded();
  });

  test('TC-CCACCESS-001 — Owner can open Clause Configuration @smoke @regression', async ({ page }) => {
    await expect(page).toHaveURL(new RegExp(`${ClauseCopy.route}(\\b|$|\\?)`));
    await expect(page.getByRole('heading', { name: ClauseCopy.title })).toBeVisible();
  });

  test('TC-CCUI-001 — page title and exact subtitle @smoke @regression', async ({ page }) => {
    await expect(page.getByRole('heading', { name: ClauseCopy.title })).toBeVisible();
    await expect(page.getByText(ClauseCopy.subtitle, { exact: true })).toBeVisible();
  });

  test('TC-CCUI-002 — info banner shows exact copy @regression', async () => {
    await expect(clause.banner()).toBeVisible();
    await expect(clause.banner()).toContainText(ClauseCopy.banner);
  });

  test('TC-CCUI-003 — table shows the four columns; checkbox column hidden in read-only @regression', async ({ page }) => {
    for (const col of ClauseCopy.columns) {
      await expect(clause.columnHeader(col)).toBeVisible();
    }
    // read-only mode: no per-row checkboxes rendered
    await expect(page.locator(L.tableRows).first().locator(L.rowCheckbox)).toHaveCount(0);
  });

  test('TC-CCUI-014 — page load renders the 16-clause table @regression', async () => {
    await expect(clause.rows()).toHaveCount(16);
  });

  test('TC-CCUI-010 — read-only header shows only Edit (no Save Changes) @regression', async () => {
    await expect(clause.editButton()).toBeVisible();
    await expect(clause.saveButton()).toHaveCount(0);
  });
});

test.describe('Clause Configuration — edit-mode entry, no persistence (US-CC-003)', () => {
  let clause: ClauseConfigurationPage;

  test.beforeEach(async ({ page }) => {
    clause = new ClauseConfigurationPage(page);
    await clause.goto();
    await clause.expectLanded();
  });

  test('TC-CCUI-020 — Edit reveals Discard + Save Changes (Save starts disabled) @regression', async () => {
    await clause.enterEditMode();
    await expect(clause.discardButton()).toBeVisible();
    await expect(clause.saveButton()).toBeVisible();
    await expect(clause.saveButton()).toBeDisabled();
    await expect(clause.editButton()).toHaveCount(0);
    await clause.discard(); // revert edit mode (no persistence)
  });

  test('TC-CCUI-021 — entering edit mode reveals per-row checkboxes @regression', async ({ page }) => {
    await clause.enterEditMode();
    await expect(page.locator(L.tableRows).first().locator(L.rowCheckbox).first()).toBeVisible();
    await clause.discard();
  });

  test('TC-CCUI-034 — disabled Save Changes shows the exact tooltip @regression', async () => {
    await clause.enterEditMode();
    await expect(clause.saveButton()).toBeDisabled();
    expect(await clause.saveTooltipText()).toBe(ClauseCopy.saveDisabledTooltip);
    await clause.discard();
  });

  test('TC-CCUI-037 — Discard exits edit mode and restores the Edit button (no confirmation when clean) @regression', async () => {
    await clause.enterEditMode();
    await clause.discard();
    await expect(clause.editButton()).toBeVisible();
    await expect(clause.saveButton()).toHaveCount(0);
  });
});
