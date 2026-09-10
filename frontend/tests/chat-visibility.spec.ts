/**
 * CEIQ-FEAT-010 — chat widget visibility matrix + state survival (AC-1, BR-2, EC-1/2/13).
 * Source: testcases/TC-CEIQ-FEAT-010.md — TC-CHATUI-001…012.
 *
 * Runs under the `po` project (PO storageState). Read-only: nothing here sends a
 * message except TC-CHATUI-011/012, which need thread state to prove it survives (or
 * does not survive) navigation.
 */
import { test, expect } from '@playwright/test';
import { ChatWidgetPage } from '../pages/ChatWidgetPage';
import { ChatRoutes } from './fixtures/expectedCopyChat';

let chat: ChatWidgetPage;

test.beforeEach(async ({ page }) => {
  chat = new ChatWidgetPage(page);
});

// A case that sends a message spends a real Bedrock round-trip (2–6 s, longer behind
// the worker queue) on top of several navigations, which does not fit the suite-wide
// 60 s default. Raised only for the cases that need it, so a genuine hang still fails.
const SLOW = 240_000;

test.describe('Chat widget — visibility by screen (AC-1)', () => {
  test('TC-CHATUI-001 — visible on the Dashboard @smoke @regression', async () => {
    await chat.expectLandedWithWidget('/dashboard');
  });

  test('TC-CHATUI-002 — visible on Contracts list and detail @smoke @regression', async ({ page }) => {
    await chat.expectLandedWithWidget('/contracts');
    // Detail page: reach it via a familyId taken from the scope picker, which is the
    // only inventory of contract ids this suite has without an API call.
    await chat.open();
    const ids = await chat.familyIdsInPicker();
    expect(ids.length, 'scope picker must list at least one contract').toBeGreaterThan(0);
    await chat.goto(`/contracts/${ids[0]}`, true);
    expect(await chat.isLauncherVisible(), 'widget must render on a contract detail page').toBe(true);
    expect(page.url()).toContain(ids[0]);
  });

  test('TC-CHATUI-003 — visible across the Sourcing module @regression', async () => {
    await chat.expectLandedWithWidget('/sourcing');
  });

  test('TC-CHATUI-004 — visible everywhere in Vendors, including create/edit @regression', async () => {
    await chat.expectLandedWithWidget('/vendors');
    // Vendors has NO exclusions at all, unlike Contracts and Sourcing — an implementer
    // applying one blanket "hide on forms" rule would fail exactly here.
    await chat.goto('/vendors/new', true);
    expect(await chat.isLauncherVisible(), 'AC-1 gives Vendors no exclusions').toBe(true);
  });

  test('TC-CHATUI-006 — NOT rendered on /contracts/upload @smoke @regression', async () => {
    await chat.goto('/contracts/upload');
    expect(await chat.widgetElementCount(), 'widget must not be in the DOM at all (not merely hidden)').toBe(0);
  });

  test('TC-CHATUI-007 — NOT rendered on /contracts/{id}/draft, for any contract @regression', async () => {
    await chat.goto('/contracts', true);
    await chat.open();
    const ids = await chat.familyIdsInPicker();
    // Two different ids: a `startsWith('/contracts/')` bug would pass with only one.
    for (const id of ids.slice(0, 2)) {
      await chat.goto(`/contracts/${id}/draft`);
      expect(await chat.widgetElementCount(), `widget must be absent on /contracts/${id}/draft`).toBe(0);
    }
  });

  test('TC-CHATUI-008 — NOT rendered on /sourcing/new @regression', async () => {
    await chat.goto('/sourcing/new');
    expect(await chat.widgetElementCount()).toBe(0);
  });

  test('TC-CHATUI-010 — NOT rendered on User Management, Clause Configuration or Company Settings @smoke @regression', async () => {
    // This rule lives in the US-CHAT-001 prose, NOT in AC-1's bullet list — the
    // easiest requirement in the spec for an implementer to miss.
    for (const route of ChatRoutes.absentModules) {
      await chat.goto(route);
      expect(await chat.widgetElementCount(), `widget must be absent on ${route}`).toBe(0);
    }
  });

  test('TC-CHATUI-011 — navigating into a hidden screen and back loses no thread (EC-1, EC-2) @smoke @regression', async ({ page }) => {
    test.setTimeout(SLOW);
    await chat.goto('/contracts', true);
    await chat.open();
    const reply = await chat.send('How many contracts are expiring in the next 30 days?');
    expect(reply.length).toBeGreaterThan(0);
    const bubblesBefore = await chat.bubbles().count();

    // BR-2 is about CLIENT-SIDE navigation. Using page.goto() here would be a full page
    // load, which BR-2 says legitimately clears state — the test would then be asserting
    // the opposite of the requirement. So navigate via in-app links only.
    const goHidden = page.getByRole('link', { name: /Create new Contract|Upload/i }).first();
    if (await goHidden.count()) {
      await goHidden.click();
      await page.waitForTimeout(3000);
      expect(await chat.widgetElementCount(), 'hidden route: the widget renders nothing').toBe(0);
      await page.goBack({ waitUntil: 'commit' });
    } else {
      test.skip(true, 'no in-app link into a hidden route on this screen — needs the upload entry point');
    }
    await page.waitForTimeout(4000);
    expect(await chat.isLauncherVisible(), 'widget must reappear').toBe(true);
    await chat.open();
    expect(
      await chat.bubbles().count(),
      'BR-2: hiding is a render decision only — it must never unmount thread state',
    ).toBe(bubblesBefore);
  });

  test('TC-CHATUI-012 — a full page reload clears every thread (EC-13, BR-2, BR-4) @regression', async ({ page }) => {
    test.setTimeout(SLOW);
    await chat.goto('/contracts', true);
    await chat.open();
    await chat.send('How many contracts are expiring in the next 30 days?');
    expect(await chat.bubbles().count()).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    // State is React-only (spec §9.1) so a reload must lose it — and nothing may
    // have been persisted to storage behind the scenes (BR-4).
    expect(await chat.isPanelOpen(), 'panel should be closed again after a reload').toBe(false);
    await chat.open();
    expect(await chat.bubbles().count(), 'every thread must be empty after a reload').toBe(0);
    await chat.expectEmptyGeneralState();

    const stored = await page.evaluate(() => {
      const hits: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? '';
        if (/chat|thread|session/i.test(k)) hits.push(k);
      }
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i) ?? '';
        if (/chat|thread|session/i.test(k)) hits.push(`session:${k}`);
      }
      return hits;
    });
    expect(stored, 'BR-4: no chat state may be persisted to browser storage').toEqual([]);
  });
});

test.describe('Chat widget — routes needing a seeded entity', () => {
  test('TC-CHATUI-005 — widget reappears on a contract detail page after save', async () => {
    test.skip(true, 'BLOCKED: needs a contract upload+save run through the UI (FEAT-009 seeding not wired into this suite) — gap G-5');
  });

  test('TC-CHATUI-009 — NOT rendered on /sourcing/{id}/edit', async () => {
    test.skip(true, 'BLOCKED: needs an editable sourcing event id; the sourcing suite owns that fixture — gap G-5');
  });
});

test.describe('Chat widget — cross-cutting', () => {
  test('TC-CHATUI-021 — exactly one widget instance across in-app navigation @regression', async ({ page }) => {
    await chat.goto('/dashboard', true);
    await chat.open();
    for (const name of ['Contracts', 'Sourcing', 'Vendors', 'Dashboard']) {
      const link = page.getByRole('link', { name: new RegExp(`^${name}$`) }).first();
      if (await link.count()) {
        await link.click();
        await page.waitForTimeout(1800);
      }
      expect(await chat.panel().count(), `one panel instance only (after ${name})`).toBeLessThanOrEqual(1);
      expect(await chat.pill().count(), `one launcher pill only (after ${name})`).toBeLessThanOrEqual(1);
    }
  });

  test('TC-CHATUI-015 — GET /chat/contracts is fetched once and cached for the session @regression', async ({ page }) => {
    test.setTimeout(SLOW);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/chat/contracts')) calls.push(r.url());
    });
    await chat.goto('/dashboard', true);
    await chat.open();
    await chat.openPicker();
    await chat.dismissPicker();
    await chat.openPicker();
    await chat.dismissPicker();
    await chat.minimise().first().click();
    await page.waitForTimeout(800);
    expect(calls.length, `§9.6: one call per session, got ${calls.length}`).toBe(1);
  });
});
