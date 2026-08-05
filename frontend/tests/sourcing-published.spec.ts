/**
 * CEIQ-FEAT-007 — Published (active) event: detail tabs + invite modal (SRC-04/05/06/08).
 * Source: testcases/TC-CEIQ-FEAT-007.md — SRCUI-054 (tabs), 060 (published doc), 070 (invite), 097 (responses).
 *
 * Runs under the `po` project (PO storageState) against QA. An ACTIVE event is SEEDED via
 * the app API (create draft → PATCH publish-gate fields → publish) and soft-deleted in
 * afterAll. The specs only READ (open tabs, open+cancel the invite modal), so no residue.
 * Navigation warms the app via the left-sidebar "Sourcing" tab, then opens the event.
 */
import { test, expect } from '@playwright/test';
import { SourcingListPage } from '../pages/SourcingListPage';
import { SourcingDetailPage } from '../pages/SourcingDetailPage';
import { SourcingApi } from '../utils/sourcingApi';
import { appBaseUrl } from '../utils/env';

const PO_STATE = 'playwright/.auth/po.json';
const sourcingUrl = (): string => `${appBaseUrl().replace(/\/$/, '')}/sourcing`;

let publishedId: string | undefined;

async function ensurePublished(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<string> {
  if (!publishedId) {
    publishedId = (await new SourcingApi(page, request).createPublishedEvent()).id;
  }
  return publishedId;
}

test.afterAll(async ({ browser }) => {
  if (!publishedId) return;
  const ctx = await browser.newContext({ storageState: PO_STATE });
  const page = await ctx.newPage();
  await page.goto(sourcingUrl());
  await new SourcingApi(page, ctx.request).deleteEvent(publishedId);
  await ctx.close();
});

test.describe('Sourcing — published event detail (SRC-04/05/08)', () => {
  test('TC-SRCUI-054 — a published event shows the tabbed detail (Overview + Document + Vendors + Comparison) and Invite @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensurePublished(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    // (the antd Tabs wrapper testid doesn't render on a queryable node; assert the tabs themselves)
    await expect(detail.tab('Overview')).toBeVisible();
    await expect(detail.tab(/document/i)).toBeVisible();
    await expect(detail.tab(/vendors/i)).toBeVisible();
    await expect(detail.tab(/comparison/i)).toBeVisible();
    await expect(detail.inviteButton()).toBeVisible();
  });

  test('TC-SRCUI-060 — the Published Document tab renders (export action) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensurePublished(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.tab(/document/i).click();
    await expect(detail.publishedDocExport()).toBeVisible();
  });

  test('TC-SRCUI-097 — the Vendors & Responses tab renders the roster table @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensurePublished(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.tab(/vendors/i).click();
    await expect(detail.vendorsResponsesTable()).toBeVisible();
  });
});

test.describe('Sourcing — invite modal (SRC-06)', () => {
  test('TC-SRCUI-070 — Invite opens the invite modal (vendor search) and cancels cleanly @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensurePublished(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.inviteButton().click();
    // The modal wrapper testid on antd Modal may not render; the search input is a real element.
    await expect(detail.inviteModalSearch()).toBeVisible();
    await page.keyboard.press('Escape'); // close without inviting
  });
});
