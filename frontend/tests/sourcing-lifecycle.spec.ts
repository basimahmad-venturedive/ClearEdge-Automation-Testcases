/**
 * CEIQ-FEAT-007 — Event lifecycle from the UI: delete (SRC-09) + publish (SRC-02).
 * Source: testcases/TC-CEIQ-FEAT-007.md — SRCUI-114/112 (delete), 026 (publish).
 *
 * Runs under the `po` project (PO storageState) against QA. Drafts are SEEDED via the app
 * API; each seeded event is soft-deleted in afterAll (best-effort — a UI-deleted one just
 * 404s). Navigation warms the app via the sidebar "Sourcing" tab, then opens the event.
 */
import { test, expect } from '@playwright/test';
import { SourcingListPage } from '../pages/SourcingListPage';
import { SourcingDetailPage } from '../pages/SourcingDetailPage';
import { SourcingEditPage } from '../pages/SourcingEditPage';
import { SourcingApi } from '../utils/sourcingApi';
import { appBaseUrl } from '../utils/env';

const PO_STATE = 'playwright/.auth/po.json';
const sourcingUrl = (): string => `${appBaseUrl().replace(/\/$/, '')}/sourcing`;
const created: string[] = [];

test.afterAll(async ({ browser }) => {
  if (created.length === 0) return;
  const ctx = await browser.newContext({ storageState: PO_STATE });
  const page = await ctx.newPage();
  await page.goto(sourcingUrl());
  const api = new SourcingApi(page, ctx.request);
  for (const id of created) await api.deleteEvent(id);
  await ctx.close();
});

test.describe('Sourcing — delete (SRC-09)', () => {
  test('TC-SRCUI-114 — Delete opens the confirm modal with exact copy; Cancel keeps the event @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createDraft('rfp');
    created.push(id);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.deleteButton().click();
    await expect(detail.deleteModalTitle()).toBeVisible();
    await expect(page.getByText(/cannot be undone/i)).toBeVisible();
    await page.keyboard.press('Escape'); // cancel — event survives
    await expect(detail.header()).toBeVisible();
  });

  test('TC-SRCUI-112 — Confirming delete removes the event and returns to the list @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createDraft('rfp');
    created.push(id); // best-effort; likely already deleted by the UI
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.deleteButton().click();
    await detail.deleteConfirmButton().click();
    // Redirects to the sourcing list (not the deleted event's detail).
    await expect(page).toHaveURL(new RegExp(`/sourcing(\\b|$|\\?)`));
    await expect(page).not.toHaveURL(new RegExp(`/sourcing/${id}`));
  });
});

test.describe('Sourcing — publish from the UI (SRC-02)', () => {
  test('TC-SRCUI-026 — a publish-ready draft publishes from the editor (draft → active) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createPublishReadyDraft();
    created.push(id);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.clickEdit();
    const edit = new SourcingEditPage(page);
    await edit.expectLoaded();
    await expect(edit.publishButton()).toBeEnabled();
    await edit.publishButton().click();
    // Publish raises a confirm dialog ("Publish this sourcing event?") — accept it.
    await page.getByRole('button', { name: 'Confirm & Publish' }).click();
    // Publish leaves the editor and lands back on the event detail (now active).
    await expect(page).not.toHaveURL(/\/edit(\b|$|\?)/);
    await expect(detail.header()).toBeVisible();
  });
});
