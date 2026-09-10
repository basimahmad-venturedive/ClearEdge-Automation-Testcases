/**
 * Retest of two fixes that share one precondition — a contract created through the UI in
 * this browser session.
 *
 *   CLRE-379  the draft/review screen (CON-03) kept showing its processing loader after
 *             Stage 1 extraction finished, on a first upload ("create" entry point).
 *   CLRE-327  a newly created contract did not appear in the chatbot's scope picker until
 *             the page was reloaded — useCreateContract invalidated the contracts-list
 *             cache but not the chat picker's separate key.
 *
 * They are ONE case on purpose: CLRE-327's whole claim is "without refreshing the page",
 * so the picker has to be opened in the same page session that created the contract. A
 * second Playwright test would get a fresh context, which is a reload by definition and
 * would pass even with the defect present.
 *
 * Cost: one real upload plus a Stage 1 extraction wait (~1-3 min on QA). The contract is
 * SAVED rather than discarded (discarding deletes it, which would void the picker
 * assertion), so it must be removed afterwards:
 *   cd automation/api-ts && TEST_ENV=qa npx tsx scripts/probe-delete-families.ts <familyId>
 * The test prints the familyId it created.
 *
 * Runs under the `po` project (Procurement Owner storageState).
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { appBaseUrl } from '../utils/env';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;

/** Reuse the api-ts fixture so the extracted content is the known-good dummy contract. */
const FIXTURE_PDF = path.resolve(
  __dirname,
  '../../api-ts/tests/fixtures/contracts/subscription_agreement_review_dummy_data.pdf',
);

const EXTRACTION_TIMEOUT = 240_000;

test.describe('Contract create — draft loader (CLRE-379) and chat picker freshness (CLRE-327)', () => {
  test('TC-CTUI-379 / TC-CHATUI-081 — extraction ends the loader, and the new contract reaches the chat picker without a reload', async ({ page }) => {
    test.setTimeout(900_000);

    // CLRE-327 evidence recorder. The accepted fix (frontend 6c58ffc) works by RE-POLLING
    // GET /chat/contracts after extraction completes - bounded at
    // CHAT_ELIGIBILITY_MAX_ATTEMPTS x CHAT_ELIGIBILITY_POLL_INTERVAL_MS (12 x 5s = ~60s) -
    // because picker eligibility also needs embedding_status=completed, which the frontend
    // cannot see and which often lands after extraction. So the contract is expected to
    // appear ASYNCHRONOUSLY without a reload, not instantly, and a single immediate check
    // would read FALSE on a healthy build. Recording the list responses also gives a
    // network-level verdict that no DOM search/pagination quirk can distort.
    const chatListCalls: Array<{ t: number; count: number; hasFamily: boolean }> = [];
    let createdFamilyId = '';
    let chatContractName = '';
    const t0 = Date.now();
    page.on('response', (res) => {
      if (res.request().method() !== 'GET' || !res.url().includes('/chat/contracts')) return;
      void res
        .json()
        .then((body: unknown) => {
          const data = (body as { data?: Record<string, unknown> })?.data ?? {};
          const rows = (data.contracts ?? []) as Array<Record<string, unknown>>;
          const mine = rows.find((r) => String(r.familyId ?? r.id ?? '') === createdFamilyId);
          if (mine && typeof mine.contractName === 'string') chatContractName = mine.contractName;
          chatListCalls.push({
            t: Math.round((Date.now() - t0) / 1000),
            count: Number(data.contractCount ?? rows.length),
            hasFamily: Boolean(mine),
          });
        })
        .catch(() => undefined);
    });

    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });

    // ── Create: upload a contract through the UI ("create" entry point) ───────────────
    await page.goto(appUrl('/contracts/upload'));
    // antd forwards Upload.Dragger's data-testid onto its hidden <input type="file">, not
    // onto the visible drop area — so the testid IS the input, and the filename shows up
    // in the dragger's own `.ant-upload-text` paragraph instead.
    const fileInput = page.getByTestId('upload-contract-dropzone');
    await expect(fileInput).toHaveCount(1, { timeout: 30_000 });
    await fileInput.setInputFiles(FIXTURE_PDF);
    await expect(page.locator('.ant-upload-text')).toContainText(
      path.basename(FIXTURE_PDF),
      { timeout: 15_000 },
    );

    // antd Select: open it, then pick the first real option from the portal-rendered list.
    await page.getByTestId('upload-contract-type-select').click();
    const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    const submit = page.getByTestId('upload-contract-submit-button');
    await expect(submit).toBeEnabled({ timeout: 15_000 });
    await submit.click();

    // The upload lands on /contracts/{familyId}/draft.
    await page.waitForURL(/\/contracts\/[0-9a-f-]{36}\/draft/i, { timeout: 120_000 });
    const familyId = page.url().match(/\/contracts\/([0-9a-f-]{36})\/draft/i)![1];
    createdFamilyId = familyId;
    // eslint-disable-next-line no-console
    console.log(`created familyId=${familyId}`);

    // ── CLRE-379 — the loader must end when extraction does ───────────────────────────
    const spinner = page.getByTestId('contract-draft-processing-spinner');
    const draftForm = page.getByTestId('contract-draft-form');

    await expect(
      draftForm,
      'CLRE-379: on a first upload the draft screen kept spinning after Stage 1 finished, ' +
      'because the detail-invalidation retry loop chased a /contracts/{id} resource that ' +
      'does not exist until Save. The review form must render once extraction completes.',
    ).toBeVisible({ timeout: EXTRACTION_TIMEOUT });

    await expect(
      spinner,
      'CLRE-379: the processing loader must be gone once the form is up — not layered ' +
      'over a form that has already arrived',
    ).toHaveCount(0, { timeout: 60_000 });

    // ── CLRE-327 — the chat picker must see it without a reload ───────────────────────
    // The widget is hidden by design on /contracts/upload and /contracts/{id}/draft
    // (FloatingChat's HIDDEN_PATHS / HIDDEN_PATTERNS, per AC-1's route inventory), so the
    // picker cannot be opened from here. Leave the draft by CLICKING the sidebar — a
    // client-side Next.js navigation keeps the same QueryClient. page.goto() would build a
    // fresh one, which is a reload in all but name and would mask this very defect.
    await page.getByRole('menuitem', { name: /Contracts/i }).click();

    // Leaving an unsaved draft raises the navigate-away modal. Save (rather than Discard)
    // — Discard deletes the contract, which would make the picker assertion meaningless.
    const navAwayModal = page.getByTestId('contract-draft-navigate-away-modal');
    if (await navAwayModal.count()) {
      await page.getByTestId('contract-draft-navigate-away-modal-save-button').first().click();
    }
    await expect(navAwayModal).toHaveCount(0, { timeout: 60_000 });
    await page.waitForURL((u) => !/\/draft$/.test(u.pathname), { timeout: 60_000 });

    const launcher = page.getByTestId('chat-launcher-pill');
    const launcherButton = page.getByTestId('chat-launcher-button');
    await expect
      .poll(async () => (await launcher.count()) + (await launcherButton.count()), { timeout: 60_000, intervals: [500] })
      .toBeGreaterThan(0);
    if (await launcher.count()) await launcher.first().click();
    else await launcherButton.first().click();
    await expect(page.getByTestId('chat-panel-card').first()).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('chat-scope-toggle-button').first().click();
    await expect(page.getByTestId('chat-scope-picker').first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => page.locator('[data-testid^="chat-scope-contract-option-"]').count(), {
        timeout: 30_000,
        intervals: [500],
      })
      .toBeGreaterThan(0);

    // The picker paginates/filters, so the row may not be in the first page. Search by the
    // contract's ACTUAL name, read out of the picker's own payload, instead of a guessed
    // literal: Stage 1 does not always name the fixture what the fixture is called (it
    // frequently extracts as "Unknown Agreement Type"), and a wrong filter term would hide
    // the row and read as a stale picker.
    const search = page.getByTestId('chat-scope-search-input');
    const pickerOption = page.getByTestId(`chat-scope-contract-option-${familyId}`);

    // Give the fix's own bounded re-poll room to run (12 x 5s = ~60s from extraction
    // complete, which happened before this navigation) plus margin for the final refetch.
    const POLL_BUDGET_MS = 120_000;
    const deadline = Date.now() + POLL_BUDGET_MS;
    let freshBeforeReload = 0;
    let lastTerm = '';
    while (Date.now() < deadline) {
      if (chatContractName && chatContractName !== lastTerm && (await search.count())) {
        await search.first().fill(chatContractName);
        lastTerm = chatContractName;
      }
      freshBeforeReload = await pickerOption.count();
      if (freshBeforeReload > 0) break;
      await page.waitForTimeout(1_000);
    }
    const appearedAfterS = Math.round((Date.now() - t0) / 1000);
    const timeline = () =>
      chatListCalls.map((c) => `${c.t}s:count=${c.count}${c.hasFamily ? ':MINE' : ''}`).join(' | ');

    // eslint-disable-next-line no-console
    console.log(`GET /chat/contracts timeline (no reload yet): ${timeline()}`);

    // Soft, so the run continues to the reload leg below and one execution yields BOTH
    // facts: whether the picker is fresh, and whether a reload is what reveals the
    // contract. A hard failure here would leave the second half unknown.
    expect
      .soft(
        freshBeforeReload,
        `CLRE-327: the contract created in this session (familyId ${familyId}) must become ` +
        'selectable in the chat scope picker WITHOUT reloading the page. The accepted fix ' +
        're-polls GET /chat/contracts for ~60s after extraction completes (embedding ' +
        `eligibility is invisible to the frontend), so this waited ${POLL_BUDGET_MS / 1000}s. ` +
        `List responses seen: ${timeline()}`,
      )
      .toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(
      `picker WITHOUT reload contains new contract: ${freshBeforeReload > 0}` +
      (freshBeforeReload > 0 ? ` (appeared ${appearedAfterS}s into the run, no reload)` : ''),
    );

    // ── Control: a reload must reveal it ──────────────────────────────────────────────
    // This is the other half of the ticket's claim ("until we refresh the page"). If the
    // contract shows up here but not above, the contract is selectable and the only
    // problem is cache freshness. If it is missing here too, something else is wrong and
    // this is not the defect described.
    await page.reload();
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });
    const launcher2 = page.getByTestId('chat-launcher-pill');
    const launcherButton2 = page.getByTestId('chat-launcher-button');
    await expect
      .poll(async () => (await launcher2.count()) + (await launcherButton2.count()), { timeout: 60_000, intervals: [500] })
      .toBeGreaterThan(0);
    if (await launcher2.count()) await launcher2.first().click();
    else await launcherButton2.first().click();
    await expect(page.getByTestId('chat-panel-card').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('chat-scope-toggle-button').first().click();
    await expect(page.getByTestId('chat-scope-picker').first()).toBeVisible({ timeout: 15_000 });
    const search2 = page.getByTestId('chat-scope-search-input');
    if (chatContractName && (await search2.count())) await search2.first().fill(chatContractName);

    await expect(
      page.getByTestId(`chat-scope-contract-option-${familyId}`),
      'control leg: after a reload the contract must be in the picker — GET /chat/contracts ' +
      'serves it, so if it is missing even here the problem is not cache freshness',
    ).toHaveCount(1, { timeout: 30_000 });
    // eslint-disable-next-line no-console
    console.log(`picker AFTER reload contains new contract: true (fresh-without-reload was ${freshBeforeReload > 0})`);
    // Cleanup is done out-of-band so a UI failure cannot leave it half-done:
    //   cd automation/api-ts && TEST_ENV=qa npx tsx scripts/probe-delete-families.ts <familyId...>
  });
});
