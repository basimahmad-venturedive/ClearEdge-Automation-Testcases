/**
 * CEIQ-FEAT-007 — Sourcing event detail + draft-edit screens (SRC-04 / SRC-02).
 * Source: testcases/TC-CEIQ-FEAT-007.md — SRCUI-048/049 (detail), 013/017/018 (edit).
 *
 * Runs under the `po` project (PO storageState) against QA. A draft event is SEEDED via
 * the app API (SourcingApi) so we open a real event without driving the slow create+publish
 * UI, and it is soft-deleted in afterAll — the specs never Save/Publish, so no residue.
 * Navigation warms the app via the left-sidebar "Sourcing" tab, then opens the event.
 */
import { test, expect } from '@playwright/test';
import { SourcingListPage } from '../pages/SourcingListPage';
import { SourcingDetailPage } from '../pages/SourcingDetailPage';
import { SourcingEditPage } from '../pages/SourcingEditPage';
import { SourcingApi } from '../utils/sourcingApi';
import { appBaseUrl } from '../utils/env';

const PO_STATE = 'playwright/.auth/po.json';
const sourcingUrl = (): string => `${appBaseUrl().replace(/\/$/, '')}/sourcing`;

let seededId: string | undefined;

/** Seed a draft once (page + request available inside the first test). */
async function ensureDraft(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<string> {
  if (!seededId) {
    seededId = (await new SourcingApi(page, request).createDraft('rfp')).id;
  }
  return seededId;
}

test.afterAll(async ({ browser }) => {
  if (!seededId) return;
  const ctx = await browser.newContext({ storageState: PO_STATE });
  const page = await ctx.newPage();
  await page.goto(sourcingUrl()); // establish app origin (token in localStorage) before the API call
  await new SourcingApi(page, ctx.request).deleteEvent(seededId);
  await ctx.close();
});

test.describe('Sourcing — event detail (SRC-04)', () => {
  test('TC-SRCUI-048 — the draft event detail renders (header, Edit + Delete actions) @regression', async ({ page, request }) => {
    // Warm the app via the sidebar first (so the deep link to the event is stable).
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await expect(detail.header()).toBeVisible();
    // A draft has no tabbed area (tabs are for published events) — assert the draft actions.
    await expect(detail.editButton()).toBeVisible();
    await expect(detail.deleteButton()).toBeVisible();
  });

  test('TC-SRCUI-049 — Overview shows the details + evaluation-criteria cards @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await expect(detail.detailsCard()).toBeVisible();
    await expect(detail.criteriaSummaryCard()).toBeVisible();
  });
});

test.describe('Sourcing — draft edit (SRC-02)', () => {
  test('TC-SRCUI-013 — Edit opens the draft editor (Publish + Save draft + Cancel, scope textarea) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.clickEdit();
    const edit = new SourcingEditPage(page);
    await edit.expectLoaded();
    await expect(edit.cancelButton()).toBeVisible();
    await expect(edit.scopeTextarea()).toBeVisible();
  });

  test('TC-SRCUI-017 — draft editor shows the criteria + vendor-questions controls @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.clickEdit();
    const edit = new SourcingEditPage(page);
    await expect(edit.criteriaAddButton()).toBeVisible();
    await expect(edit.questionsAddButton()).toBeVisible();
  });

  test('TC-SRCUI-018 — Cancel from the editor returns to the event detail (no save) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.clickEdit();
    const edit = new SourcingEditPage(page);
    await expect(edit.publishButton()).toBeVisible(); // confirm we're in the editor
    await edit.cancel();
    // Cancel leaves the editor (no save). The Publish button is edit-only, so its
    // disappearance is the robust signal that we exited the draft editor.
    await expect(edit.publishButton()).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/edit(\b|$|\?)/);
  });
});
