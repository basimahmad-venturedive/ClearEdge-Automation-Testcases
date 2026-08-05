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

  test('TC-SRCACCESS-005 — Manager sees Edit / Invite / Delete on a draft detail @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createDraft('rfp'); // Manager token creates
    created.push(id);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    // The whole action block is canManage-gated — Manager sees every control.
    await expect(detail.editButton()).toBeVisible();   // "Edit draft" (draft status)
    await expect(detail.inviteButton()).toBeVisible();  // "Invite vendors"
    await expect(detail.deleteButton()).toBeVisible();  // "Delete"
  });

  test('TC-SRCACCESS-006 — Manager reaches the draft editor (no manage_sourcing route-guard bounce) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const { id } = await new SourcingApi(page, request).createDraft('rfp');
    created.push(id);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await detail.clickEdit(); // asserts URL → /sourcing/:id/edit (guard did NOT redirect)
    await new SourcingEditPage(page).expectLoaded();
  });
});
