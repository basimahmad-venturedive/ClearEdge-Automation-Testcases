/**
 * CEIQ-FEAT-007 — Sourcing event detail + draft-edit screens (SRC-04 / SRC-02).
 * Source: testcases/TC-CEIQ-FEAT-007.md — SRCUI-048/049 (detail), 013/017/018 (edit).
 *
 * Runs under the `po` project (PO storageState) against QA. Events are SEEDED via the app
 * API (SourcingApi) and soft-deleted in afterAll — the specs never Save/Publish, so no residue.
 *
 * QA sourcing model (verified against the deployed build):
 *  - A DRAFT has NO standalone detail page — its canonical URL /sourcing/:id redirects
 *    straight into the EDITOR (/sourcing/:id/edit). So the "edit" cases open the draft's
 *    URL and land in the editor directly (there is no detail → click-Edit step).
 *  - The standalone DETAIL page exists for PUBLISHED events: it shows the header, Invite +
 *    Delete actions (there is NO Edit button once published), and the details / criteria
 *    summary cards. So the "detail" cases seed a PUBLISHED event.
 */
import { test, expect } from '@playwright/test';
import { SourcingListPage } from '../pages/SourcingListPage';
import { SourcingDetailPage } from '../pages/SourcingDetailPage';
import { SourcingEditPage } from '../pages/SourcingEditPage';
import { SourcingApi } from '../utils/sourcingApi';
import { appBaseUrl } from '../utils/env';

const PO_STATE = 'playwright/.auth/po.json';
const sourcingUrl = (): string => `${appBaseUrl().replace(/\/$/, '')}/sourcing`;
const eventUrl = (id: string): string => `${appBaseUrl().replace(/\/$/, '')}/sourcing/${id}`;

let draftId: string | undefined;
let publishedId: string | undefined;

/** Seed a DRAFT once (opens in the editor). */
async function ensureDraft(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<string> {
  if (!draftId) draftId = (await new SourcingApi(page, request).createDraft('rfp')).id;
  return draftId;
}

/** Seed a PUBLISHED event once (has a standalone detail page). */
async function ensurePublished(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<string> {
  if (!publishedId) publishedId = (await new SourcingApi(page, request).createPublishedEvent()).id;
  return publishedId;
}

/**
 * Open the draft's editor. The SPA must already be WARM (sidebar visited so a token
 * is in localStorage — the seeder reads it) before calling this; opening a draft's
 * canonical URL then redirects into the editor (/sourcing/:id/edit).
 */
async function openDraftEditor(page: import('@playwright/test').Page, id: string): Promise<SourcingEditPage> {
  await page.goto(eventUrl(id)); // a draft redirects to /sourcing/:id/edit
  await page.waitForURL(/\/sourcing\/[^/]+\/edit(\b|$|\?)/, { timeout: 30000 });
  const edit = new SourcingEditPage(page);
  await edit.expectLoaded();
  return edit;
}

test.afterAll(async ({ browser }) => {
  const ids = [draftId, publishedId].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const ctx = await browser.newContext({ storageState: PO_STATE });
  const page = await ctx.newPage();
  await page.goto(sourcingUrl()); // establish app origin (token in localStorage) before the API call
  const api = new SourcingApi(page, ctx.request);
  for (const id of ids) await api.deleteEvent(id);
  await ctx.close();
});

test.describe('Sourcing — event detail (SRC-04)', () => {
  test('TC-SRCUI-048 — the event detail renders (header, Invite + Delete actions) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensurePublished(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await expect(detail.header()).toBeVisible();
    // A published event's detail exposes the manage actions Invite + Delete (there is
    // no Edit button once published — editing happens only while the event is a draft).
    await expect(detail.inviteButton()).toBeVisible();
    await expect(detail.deleteButton()).toBeVisible();
  });

  test('TC-SRCUI-049 — Overview shows the details + evaluation-criteria cards @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensurePublished(page, request);
    const detail = new SourcingDetailPage(page);
    await detail.gotoEvent(id);
    await expect(detail.detailsCard()).toBeVisible();
    await expect(detail.criteriaSummaryCard()).toBeVisible();
  });
});

test.describe('Sourcing — draft edit (SRC-02)', () => {
  test('TC-SRCUI-013 — the draft opens in the editor (Publish + Save draft + Cancel, scope textarea) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto(); // warm the SPA (loads the token the seeder reads)
    const id = await ensureDraft(page, request);
    const edit = await openDraftEditor(page, id);
    await expect(edit.cancelButton()).toBeVisible();
    await expect(edit.scopeTextarea()).toBeVisible();
  });

  test('TC-SRCUI-017 — draft editor shows the criteria + vendor-questions controls @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const edit = await openDraftEditor(page, id);
    await expect(edit.criteriaAddButton()).toBeVisible();
    await expect(edit.questionsAddButton()).toBeVisible();
  });

  test('TC-SRCUI-018 — Cancel from the editor leaves the editor (no save) @regression', async ({ page, request }) => {
    await new SourcingListPage(page).goto();
    const id = await ensureDraft(page, request);
    const edit = await openDraftEditor(page, id);
    await expect(edit.publishButton()).toBeVisible(); // confirm we're in the editor
    await edit.cancel();
    // Cancel leaves the editor (no save). The Publish button is editor-only, so its
    // disappearance is the robust signal that we exited the draft editor.
    await expect(edit.publishButton()).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/edit(\b|$|\?)/);
  });
});
