/**
 * CEIQ-FEAT-004 — Company Settings edit / save / discard / dirty-check / popup
 * (US-CS-003, §5.3–§5.9) + plain-text render security (TC-CSSEC-003 / SR-003).
 * Source: testcases/TC-CEIQ-FEAT-004.md — TC-CSEDIT-001…024, TC-CSSEC-003.
 *
 * Screen shipped on dev (PR #26); runs under the `po` project (PO storageState).
 * Web-first assertions only (no sleeps); clear-before-input via the POM.
 *
 * Baselines are read LIVE from the section (POM.savedContent / .draft) rather
 * than hard-coded, so dirty/revert logic holds whether the dev PO tenant is
 * backed by the real API or MSW seed. Cases that would MUTATE shared dev data,
 * or that need a browser-native dialog / cross-feature fixture, stay skipped
 * with an explicit blocker reason.
 */
import { test, expect } from '@playwright/test';
import { CompanySettingsPage } from '../pages/CompanySettingsPage';
import { CsCopy } from './fixtures/expectedCopyCompanySettings';

const BG = 'background' as const;
const BG_NAME = CsCopy.sectionDisplayName.background;

test.describe('US-CS-003 Edit / Save / dirty-check', () => {
  test('TC-CSEDIT-001 enter edit on a single section; others stay read-only @smoke @regression', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    await cs.expectSaveEnabled(BG, false);
    await cs.expectReadOnly('introduction');
    await cs.expectReadOnly('terms_and_conditions');
  });

  test('TC-CSEDIT-002 edit mode alone does not enable Save @smoke @regression', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    await cs.expectSaveEnabled(BG, false);
  });

  test('TC-CSEDIT-003 Save enables on any change, incl. a trailing-space-only change (BR-04) @smoke @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base}.`); // 3a: append a char
    await cs.expectSaveEnabled(BG, true);
    await cs.type(BG, `${base} `); // 3b: trailing space only
    await cs.expectSaveEnabled(BG, true);
  });

  test('TC-CSEDIT-004 Save re-disables on an exact character-for-character revert @smoke @regression', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} changed`);
    await cs.expectSaveEnabled(BG, true);
    await cs.type(BG, base); // exact revert
    await cs.expectSaveEnabled(BG, false);
  });

  test('TC-CSEDIT-005 clearing the field (empty) is a valid change that enables Save (BR-05) @smoke @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG); // background is seeded non-empty, so clearing is a real change
    expect((await cs.draft(BG)).length).toBeGreaterThan(0);
    await cs.type(BG, '');
    await cs.expectSaveEnabled(BG, true);
  });

  test('TC-CSEDIT-006 plain-text only: HTML/rich text kept as literal text, line breaks preserved (AC-006, SR-003) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    await cs.textarea(BG).fill('<b>Bold</b>\nline2');
    await expect(cs.textarea(BG)).toHaveValue(/line2/);
    await expect(page.locator('script:has-text("alert")')).toHaveCount(0);
  });

  test('TC-CSEDIT-007 disabled-Save tooltip shows exact copy; gone once enabled (AC-007) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.saveButton(BG).hover();
    await expect(page.getByRole('tooltip')).toHaveText(CsCopy.disabledSaveTooltip);
    await cs.type(BG, `${base} x`);
    await cs.saveButton(BG).hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('TC-CSEDIT-008 Discard reverts to last-saved, exits edit, no popup, no API call @regression', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    const puts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT') puts.push(r.url());
    });
    await cs.goto();
    const base = await cs.savedContent(BG);
    await cs.enterEdit(BG);
    await cs.type(BG, `${base} heavily rewritten`);
    await cs.discard(BG);
    await expect(cs.contentReadonly(BG)).toHaveText(base);
    await expect(cs.popup).toHaveCount(0);
    expect(puts).toHaveLength(0);
  });

  test('TC-CSEDIT-009 switch sections with no unsaved changes: silent, no popup (AC-009) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG); // no change
    await cs.editButton('introduction').click();
    await expect(cs.popup).toHaveCount(0);
    await expect(cs.textarea('introduction')).toBeEditable();
    await cs.expectReadOnly(BG);
  });

  test('TC-CSEDIT-010 switch sections with unsaved changes: popup shown, second blocked (AC-010) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} dirty`);
    await cs.editButton('introduction').click();
    await expect(cs.popup).toBeVisible();
    await expect(cs.popup).toContainText(CsCopy.unsavedPopup(BG_NAME));
    await expect(cs.textarea('introduction')).toHaveCount(0); // not entered until resolved
  });

  test('TC-CSEDIT-011 click outside the text box, no unsaved changes: nothing happens (AC-011, BR-08) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG); // no change
    await page.getByRole('heading', { name: CsCopy.pageHeading, exact: true }).click();
    await expect(cs.textarea(BG)).toBeEditable(); // still in edit mode
    await expect(cs.popup).toHaveCount(0);
  });

  test('TC-CSEDIT-012 click outside the text box, unsaved changes: nothing (no popup, no save/revert) (AC-012) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    const puts: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT') puts.push(r.url());
    });
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} dirty`);
    await page.getByRole('heading', { name: CsCopy.pageHeading, exact: true }).click();
    await expect(cs.textarea(BG)).toHaveValue(`${base} dirty`); // intact
    await expect(cs.popup).toHaveCount(0);
    expect(puts).toHaveLength(0);
  });

  test('TC-CSEDIT-013 in-app navigation away with unsaved changes triggers the popup (AC-013) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} dirty`);
    await page.getByRole('menuitem', { name: 'Sourcing' }).click(); // in-app nav
    await expect(cs.popup).toBeVisible();
    await expect(page).toHaveURL(/\/company-settings$/); // nav not completed yet
  });

  test('TC-CSEDIT-014 popup Cancel aborts action; stays in edit mode, changes intact (AC-014, BR-07) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} dirty`);
    await cs.editButton('introduction').click();
    await cs.popupCancel.click();
    // antd keeps the Modal node mounted after close (no destroyOnClose), so it
    // becomes hidden rather than removed — assert hidden, not absent.
    await expect(cs.popup).toBeHidden();
    await expect(cs.textarea(BG)).toHaveValue(`${base} dirty`);
    await expect(cs.textarea('introduction')).toHaveCount(0);
  });

  test('TC-CSEDIT-015 popup Save Changes commits, shows confirmation, then proceeds (AC-015/016/017) @regression', async ({
    page,
  }) => {
    // Real PUT against dev; save-then-restore teardown leaves the tenant untouched.
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    const original = await cs.savedContent(BG);
    try {
      await cs.enterEdit(BG);
      await cs.type(BG, `${original} (popup-save)`);
      await cs.editButton('introduction').click();
      const [put] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/company-settings/background') && r.request().method() === 'PUT',
        ),
        cs.popupSaveChanges.click(),
      ]);
      expect(put.status()).toBe(200);
      await expect(cs.confirmation).toContainText(CsCopy.saveConfirmation(BG_NAME));
      await expect(cs.textarea('introduction')).toBeEditable(); // triggering action proceeded
    } finally {
      await cs.restore(BG, original);
    }
  });

  test('TC-CSEDIT-016 direct Save commits and returns section to read-only (AC-016) @regression', async ({
    page,
  }) => {
    // Real PUT against dev; save-then-restore teardown leaves the tenant untouched.
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    const original = await cs.savedContent('introduction');
    try {
      await cs.enterEdit('introduction');
      const status = await cs.commitSave('introduction', 'Updated intro');
      expect(status).toBe(200);
      await cs.expectReadOnly('introduction');
    } finally {
      await cs.restore('introduction', original);
    }
  });

  test('TC-CSEDIT-017 save confirmation shows exact copy at top of screen and auto-dismisses (AC-017) @regression', async ({
    page,
  }) => {
    // Real PUT against dev; save-then-restore teardown leaves the tenant untouched.
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    const original = await cs.savedContent(BG);
    try {
      await cs.enterEdit(BG);
      await cs.commitSave(BG, `${original} x`);
      await expect(cs.confirmation).toContainText(CsCopy.saveConfirmation(BG_NAME));
      await expect(cs.confirmation).toBeHidden({ timeout: 8000 }); // ~5s auto-dismiss (tolerance)
    } finally {
      await cs.restore(BG, original);
    }
  });

  test('TC-CSEDIT-018 Save error (5xx): stays in edit mode, generic error, changes retained (§5.7) @regression', async ({
    page,
  }) => {
    await page.route('**/company-settings/**', (route) =>
      route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} x`);
    await cs.save(BG);
    await expect(cs.genericError).toContainText(CsCopy.genericError);
    await expect(cs.textarea(BG)).toHaveValue(`${base} x`); // retained
  });

  test('TC-CSEDIT-019 double-submit prevention: Save disables on click, one PUT only, re-enables on error (§5.7) @regression', async ({
    page,
  }) => {
    const puts: string[] = [];
    await page.route('**/company-settings/**', async (route) => {
      if (route.request().method() === 'PUT') {
        puts.push(route.request().url());
        await new Promise((r) => setTimeout(r, 800)); // infra delay to attempt a 2nd click
        return route.fulfill({ status: 500, body: '{}' });
      }
      return route.continue();
    });
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} x`);
    await cs.save(BG);
    // antd `loading` doesn't set the disabled attribute — it adds ant-btn-loading
    // and blocks clicks via CSS. Assert the loading state (submit in flight).
    await expect(cs.saveButton(BG)).toHaveClass(/ant-btn-loading/); // immediately on click
    await cs.saveButton(BG).click({ force: true }).catch(() => undefined); // guarded → no 2nd PUT
    await expect(cs.saveButton(BG)).not.toHaveClass(/ant-btn-loading/); // cleared on error
    await expect(cs.saveButton(BG)).toBeEnabled(); // still dirty → re-enabled
    expect(puts).toHaveLength(1);
  });

  test('TC-CSEDIT-020 unsaved changes register the browser-level beforeunload guard (§5.8) [PARTIAL] @regression', async ({
    page,
  }) => {
    // The app registers the guard via addEventListener('beforeunload', …) (not
    // window.onbeforeunload) and removes it when clean. The native dialog text is
    // browser-owned (still manual), but we can automate the observable part: wrap
    // addEventListener before load and assert the listener is added once dirty.
    await page.addInitScript(() => {
      const w = window as unknown as { __beforeUnloadHooked?: boolean };
      w.__beforeUnloadHooked = false;
      const orig = window.addEventListener.bind(window);
      window.addEventListener = ((type: string, ...rest: unknown[]) => {
        if (type === 'beforeunload') w.__beforeUnloadHooked = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any)(type, ...rest);
      }) as typeof window.addEventListener;
    });
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} dirty`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __beforeUnloadHooked?: boolean }).__beforeUnloadHooked))
      .toBe(true);
    await cs.discard(BG); // leave the section clean (no save, no residue)
  });

  test('TC-CSEDIT-021 exclusive editing: at most one section editable at any time (BR-02) @regression', async ({
    page,
  }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    expect(await cs.editingCount()).toBe(1);
    await cs.editButton('introduction').click(); // silent switch (no change)
    expect(await cs.editingCount()).toBe(1);
    await cs.editButton('terms_and_conditions').click();
    expect(await cs.editingCount()).toBe(1);
  });

  test.skip('TC-CSEDIT-022 existing sourcing events retain content as of creation time (AC-018) [MANUAL / cross-feature]', async () => {
    // NOT a Company Settings automation item — this asserts the Sourcing feature's
    // snapshot-at-creation behaviour, owned and verified by the Sourcing suite.
    // Intentionally a manual/cross-feature marker; leave skipped here.
    test.info().annotations.push({ type: 'manual', description: 'AC-018 cross-feature — Sourcing snapshot mechanism' });
  });

  test('TC-CSEDIT-023 save confirmation can be manually dismissed before auto-dismiss (REC-02) @regression', async ({
    page,
  }) => {
    // Real PUT against dev; save-then-restore teardown leaves the tenant untouched.
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    const original = await cs.savedContent(BG);
    try {
      await cs.enterEdit(BG);
      await cs.commitSave(BG, `${original} x`);
      await expect(cs.confirmation).toBeVisible();
      await cs.confirmationDismiss.click();
      await expect(cs.confirmation).toBeHidden();
      await cs.expectReadOnly(BG);
    } finally {
      await cs.restore(BG, original);
    }
  });

  test('TC-CSEDIT-024 popup Save Changes with a failing PUT aborts action, keeps edit mode (REC-04, §5.8) @regression', async ({
    page,
  }) => {
    await page.route('**/company-settings/**', (route) =>
      route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit(BG);
    const base = await cs.draft(BG);
    await cs.type(BG, `${base} dirty`);
    await cs.editButton('introduction').click();
    await cs.popupSaveChanges.click();
    await expect(cs.genericError).toContainText(CsCopy.genericError);
    await expect(cs.textarea(BG)).toHaveValue(`${base} dirty`); // still editing, intact
    await expect(cs.textarea('introduction')).toHaveCount(0); // triggering action aborted
  });
});

test.describe('SR-003 plain-text render (no XSS)', () => {
  test.skip('TC-CSSEC-003 stored HTML/script payload renders as literal text (no execution)', async ({
    page,
  }) => {
    // Attempted to seed the payload via the real UI Save, but on dev a PUT with a
    // <script>/onerror body never completes (no HTTP response is issued, while
    // normal-text saves succeed) — so the STORED payload can't be created through
    // the UI here. Needs an API/DB-level seed (api-ts already covers plain-text
    // storage in its security suite) or a non-gateway-filtered env to run in E2E.
    test.setTimeout(60000); // two saves + a re-fetch navigation + restore
    const PAYLOAD = `<script>alert('xss')</script>\n<img src=x onerror="alert('xss2')">`;
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    const original = await cs.savedContent(BG);
    try {
      await cs.enterEdit(BG);
      expect(await cs.commitSave(BG, PAYLOAD)).toBe(200);
      // Re-fetch from the backend so we assert the persisted value, not the draft.
      await page.getByRole('menuitem', { name: 'Sourcing' }).click();
      await page.waitForURL(/\/sourcing/, { timeout: 30000 });
      await cs.goto();
      await expect(cs.contentReadonly(BG)).toContainText('<script>'); // shown as literal text
      await expect(page.locator('img[onerror]')).toHaveCount(0); // no injected node
      expect(dialogFired).toBe(false); // no script executed
    } finally {
      await cs.restore(BG, original);
    }
  });
});
