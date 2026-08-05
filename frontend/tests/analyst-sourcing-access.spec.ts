/**
 * CEIQ-FEAT-007 — Sourcing role-based access: PROCUREMENT ANALYST (view-only).
 * Source: testcases/TC-CEIQ-FEAT-007.md — TC-SRCACCESS (Analyst rows).
 *
 * Runs under the `analyst` project (Analyst storageState from auth.setup). The Analyst
 * holds ONLY `view_sourcing` (all 3 roles have it — so the list is fully visible) but NOT
 * `manage_sourcing`, so every write control is withheld and the two manage-only routes
 * (`/sourcing/new`, `/sourcing/:id/edit`) bounce it off via useRightGuard.
 *
 * The Analyst cannot create events (no manage_sourcing), so the draft used by the
 * detail/edit-guard cases is seeded through the app API with the PROCUREMENT OWNER's
 * session (po.json, saved by auth.setup) and soft-deleted afterwards.
 *
 * app source confirming the gate:
 *   SourcingListView.tsx        — "New sourcing event" is `canManage ? … : undefined`  (hidden)
 *   SourcingDetailHeader.tsx    — Edit/Invite/Delete `extra` block is `canManage && …`  (hidden)
 *   sourcing/new/page.tsx + [id]/edit — useRightGuard("manage_sourcing") → replace() off the route
 */
import { test, expect } from '@playwright/test';
import { SourcingListPage } from '../pages/SourcingListPage';
import { SourcingDetailPage } from '../pages/SourcingDetailPage';
import { SourcingApi } from '../utils/sourcingApi';
import { appBaseUrl } from '../utils/env';

const PO_STATE = 'playwright/.auth/po.json';
const appUrl = (path: string): string => `${appBaseUrl().replace(/\/$/, '')}${path}`;

// A draft seeded via the OWNER (Analyst can't create) and shared by the detail/edit cases.
let draftId = '';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: PO_STATE });
  const page = await ctx.newPage();
  await page.goto(appUrl('/sourcing'));
  const { id } = await new SourcingApi(page, ctx.request).createDraft('rfp');
  draftId = id;
  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  if (!draftId) return;
  const ctx = await browser.newContext({ storageState: PO_STATE });
  const page = await ctx.newPage();
  await page.goto(appUrl('/sourcing'));
  await new SourcingApi(page, ctx.request).deleteEvent(draftId);
  await ctx.close();
});

test.describe('Sourcing access — Procurement Analyst (view_sourcing, read-only)', () => {
  test('TC-SRCACCESS-001 — Analyst can open the Sourcing list (view_sourcing held by all roles) @regression', async ({ page }) => {
    const list = new SourcingListPage(page);
    await list.goto(); // sidebar "Sourcing" tab is present (view_sourcing) → /sourcing
    await expect(list.searchBox()).toBeVisible(); // the list itself renders
  });

  test('TC-SRCACCESS-003 — Analyst does NOT see the "New sourcing event" action @regression', async ({ page }) => {
    const list = new SourcingListPage(page);
    await list.goto();
    await expect(list.searchBox()).toBeVisible();     // list loaded…
    await expect(list.newButton()).toHaveCount(0);    // …but the create button is withheld
  });

  test('TC-SRCACCESS-004 — Analyst sees NO Edit / Invite / Delete on an event detail @regression', async ({ page }) => {
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(draftId); // header renders (read is allowed)…
    await expect(detail.header()).toBeVisible();
    await expect(detail.editButton()).toHaveCount(0);   // …every write control is withheld
    await expect(detail.inviteButton()).toHaveCount(0);
    await expect(detail.deleteButton()).toHaveCount(0);
  });

  test('TC-SRCACCESS-007 — Analyst hitting /sourcing/new directly is bounced by the route guard @regression', async ({ page }) => {
    await new SourcingListPage(page).goto(); // warm the SPA so this isn't the first-deep-link bounce
    await page.goto(appUrl('/sourcing/new'));
    // useRightGuard redirects off the manage-only route (to the tracked prev screen / dashboard).
    await page.waitForURL((u) => !u.pathname.endsWith('/new'), { timeout: 15000 });
    await expect(page).not.toHaveURL(/\/sourcing\/new(\b|$|\?)/);
  });

  test('TC-SRCACCESS-008 — Analyst hitting /sourcing/:id/edit directly is bounced by the route guard @regression', async ({ page }) => {
    await new SourcingListPage(page).goto();
    await page.goto(appUrl(`/sourcing/${draftId}/edit`));
    await page.waitForURL((u) => !u.pathname.endsWith('/edit'), { timeout: 15000 });
    await expect(page).not.toHaveURL(/\/edit(\b|$|\?)/);
  });
});
