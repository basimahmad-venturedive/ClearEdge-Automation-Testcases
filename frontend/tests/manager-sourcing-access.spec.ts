/**
 * CEIQ-FEAT-007 — Sourcing role-based access: PROCUREMENT MANAGER (parity with Owner).
 * Source: testcases/TC-CEIQ-FEAT-007.md — TC-SRCACCESS (Manager rows).
 *
 * Runs under the `pm` project (Manager storageState from auth.setup). The Manager holds
 * `view_sourcing` + `manage_sourcing`, so its Sourcing UX is identical to the Owner's:
 * it sees the "New sourcing event" button (list) and Edit/Invite/Delete on a draft detail,
 * and can reach the draft editor (`/:id/edit`) without the manage_sourcing route guard
 * bouncing it. Drafts are seeded through the app API with the MANAGER's own token
 * (manage_sourcing permits create) and soft-deleted in afterAll.
 *
 * app source confirming the gate:
 *   SourcingListView.tsx        — "New sourcing event" button is `canManage ? … : undefined`
 *   SourcingDetailHeader.tsx    — the whole Edit/Invite/Delete `extra` block is `canManage && …`
 *   EditSourcingPageClient.tsx  — useRightGuard("manage_sourcing") (Manager is allowed)
 */
import { test, expect } from '@playwright/test';
import { SourcingListPage } from '../pages/SourcingListPage';
import { SourcingDetailPage } from '../pages/SourcingDetailPage';
import { SourcingEditPage } from '../pages/SourcingEditPage';
import { SourcingApi } from '../utils/sourcingApi';
import { appBaseUrl } from '../utils/env';

const created: string[] = [];

test.afterEach(async ({ page, request }) => {
  if (created.length === 0) return;
  const api = new SourcingApi(page, request);
  for (const id of created.splice(0)) await api.deleteEvent(id);
});

test.describe('Sourcing access — Procurement Manager (manage_sourcing parity)', () => {
  test('TC-SRCACCESS-002 — Manager sees the Sourcing list AND the "New sourcing event" action @regression', async ({ page }) => {
    const list = new SourcingListPage(page);
    await list.goto(); // sidebar "Sourcing" tab → /sourcing (view_sourcing)
    // Parity with the Owner: the manage_sourcing-gated create button is present.
    await expect(list.newButton()).toBeVisible();
  });

  test('TC-SRCACCESS-005 — Manager sees the manage controls (Invite / Delete) on a published event detail @regression', async ({ page, request }) => {
    // On this build a DRAFT has no standalone detail page (it opens straight in the
    // editor — see TC-SRCACCESS-006), so the manage-only detail controls surface on a
    // PUBLISHED event's detail. Published details expose Invite + Delete (there is no
    // Edit button once published); both are canManage-gated, so a Manager (manage_sourcing
    // parity with the Owner) sees them.
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createPublishedEvent(); // Manager token
    created.push(id);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await expect(detail.header()).toBeVisible();
    await expect(detail.inviteButton()).toBeVisible();  // "Invite vendors"
    await expect(detail.deleteButton()).toBeVisible();  // "Delete"
  });

  test('TC-SRCACCESS-006 — Manager reaches the draft editor (no manage_sourcing route-guard bounce) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createDraft('rfp');
    created.push(id);
    // A draft's canonical URL redirects straight to the editor for a manage user — so
    // landing on /sourcing/:id/edit IS the proof the manage_sourcing guard let the
    // Manager through (an Analyst is bounced off /edit instead).
    await page.goto(`${appBaseUrl().replace(/\/$/, '')}/sourcing/${id}`);
    await page.waitForURL(/\/sourcing\/[^/]+\/edit(\b|$|\?)/, { timeout: 30000 });
    await new SourcingEditPage(page).expectLoaded();
  });
});
