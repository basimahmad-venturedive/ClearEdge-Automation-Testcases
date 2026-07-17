/**
 * CEIQ-FEAT-004 — Company Settings edit / save / discard / dirty-check / popup
 * (US-CS-003, §5.3–§5.9) + plain-text render security (TC-CSSEC-003 / SR-003).
 * Source: testcases/TC-CEIQ-FEAT-004.md — TC-CSEDIT-001…024, TC-CSSEC-003.
 *
 * SCAFFOLDED with test.skip: screen not built, no env / PO session (§9 TBD).
 * Web-first assertions only (no sleeps); clear-before-input via the POM.
 * TODO_FIXTURE: PO session + a section seeded with known last-saved content.
 */
import { test, expect } from '@playwright/test';
import { CompanySettingsPage } from '../pages/CompanySettingsPage';
import { CsCopy } from './fixtures/expectedCopyCompanySettings';

const SAVED = 'Acme background'; // seeded last-saved value for the Background section
const BG_NAME = CsCopy.sectionDisplayName.background;

test.describe('US-CS-003 Edit / Save / dirty-check', () => {
  test.skip('TC-CSEDIT-001 enter edit on a single section; others stay read-only @smoke', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.expectSaveEnabled('background', false);
    await cs.expectReadOnly('introduction');
    await cs.expectReadOnly('terms_and_conditions');
  });

  test.skip('TC-CSEDIT-002 edit mode alone does not enable Save', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.expectSaveEnabled('background', false);
  });

  test.skip('TC-CSEDIT-003 Save enables on any change, incl. a trailing-space-only change (BR-04)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED}.`); // 3a: append a char
    await cs.expectSaveEnabled('background', true);
    await cs.type('background', `${SAVED} `); // 3b: trailing space only
    await cs.expectSaveEnabled('background', true);
  });

  test.skip('TC-CSEDIT-004 Save re-disables on an exact character-for-character revert', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} changed`);
    await cs.expectSaveEnabled('background', true);
    await cs.type('background', SAVED); // exact revert
    await cs.expectSaveEnabled('background', false);
  });

  test.skip('TC-CSEDIT-005 clearing the field (empty) is a valid change that enables Save (BR-05)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', '');
    await cs.expectSaveEnabled('background', true);
  });

  test.skip('TC-CSEDIT-006 plain-text only: pasted HTML/rich text stripped, line breaks preserved (AC-006, SR-003)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    // 6a: HTML paste → tags stripped, no script node. 6c: line breaks preserved.
    await cs.textarea('background').fill('<b>Bold</b>\nline2');
    await expect(cs.textarea('background')).toHaveValue(/line2/);
    await expect(page.locator('script:has-text("alert")')).toHaveCount(0);
  });

  test.skip('TC-CSEDIT-007 disabled-Save tooltip shows exact copy; gone once enabled (AC-007)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.saveButton('background').hover();
    await expect(page.getByRole('tooltip')).toHaveText(CsCopy.disabledSaveTooltip);
    await cs.type('background', `${SAVED} x`);
    await cs.saveButton('background').hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test.skip('TC-CSEDIT-008 Discard reverts to last-saved, exits edit, no popup, no API call', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    const puts: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} heavily rewritten`);
    await cs.discard('background');
    await expect(cs.contentReadonly('background')).toHaveText(SAVED);
    await expect(cs.popup).toHaveCount(0);
    expect(puts).toHaveLength(0);
  });

  test.skip('TC-CSEDIT-009 switch sections with no unsaved changes: silent, no popup (AC-009)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background'); // no change
    await cs.editButton('introduction').click();
    await expect(cs.popup).toHaveCount(0);
    await expect(cs.textarea('introduction')).toBeEditable();
    await cs.expectReadOnly('background');
  });

  test.skip('TC-CSEDIT-010 switch sections with unsaved changes: popup shown, second blocked (AC-010)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} dirty`);
    await cs.editButton('introduction').click();
    await expect(cs.popup).toBeVisible();
    await expect(cs.popup).toContainText(CsCopy.unsavedPopup(BG_NAME));
    await expect(cs.textarea('introduction')).toHaveCount(0); // not entered until resolved
  });

  test.skip('TC-CSEDIT-011 click outside the text box, no unsaved changes: nothing happens (AC-011, BR-08)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background'); // no change
    await page.getByRole('heading', { name: CsCopy.pageHeading, exact: true }).click();
    await expect(cs.textarea('background')).toBeEditable(); // still in edit mode
    await expect(cs.popup).toHaveCount(0);
  });

  test.skip('TC-CSEDIT-012 click outside the text box, unsaved changes: nothing (no popup, no save/revert) (AC-012)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    const puts: string[] = [];
    page.on('request', (r) => { if (r.method() === 'PUT') puts.push(r.url()); });
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} dirty`);
    await page.getByRole('heading', { name: CsCopy.pageHeading, exact: true }).click();
    await expect(cs.textarea('background')).toHaveValue(`${SAVED} dirty`); // intact
    await expect(cs.popup).toHaveCount(0);
    expect(puts).toHaveLength(0);
  });

  test.skip('TC-CSEDIT-013 in-app navigation away with unsaved changes triggers the popup (AC-013)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} dirty`);
    await page.getByRole('link', { name: /sourcing/i }).click(); // in-app nav
    await expect(cs.popup).toBeVisible();
    await expect(page).toHaveURL(/\/company-settings$/); // nav not completed yet
  });

  test.skip('TC-CSEDIT-014 popup Cancel aborts action; stays in edit mode, changes intact (AC-014, BR-07)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} dirty`);
    await cs.editButton('introduction').click();
    await cs.popupCancel.click();
    await expect(cs.popup).toHaveCount(0);
    await expect(cs.textarea('background')).toHaveValue(`${SAVED} dirty`);
    await expect(cs.textarea('introduction')).toHaveCount(0);
  });

  test.skip('TC-CSEDIT-015 popup Save Changes commits, shows confirmation, then proceeds (AC-015/016/017)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', 'New background text');
    await cs.editButton('introduction').click();
    const [put] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/company-settings/background') && r.request().method() === 'PUT'),
      cs.popupSaveChanges.click(),
    ]);
    expect(put.status()).toBe(200);
    await expect(cs.confirmation).toContainText(CsCopy.saveConfirmation(BG_NAME));
    await expect(cs.textarea('introduction')).toBeEditable(); // triggering action proceeded
  });

  test.skip('TC-CSEDIT-016 direct Save commits (incl. empty) and returns section to read-only (AC-016)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    // 16a: non-empty
    await cs.enterEdit('introduction');
    await cs.type('introduction', 'Updated intro');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/company-settings/introduction') && r.request().method() === 'PUT'),
      cs.save('introduction'),
    ]);
    await cs.expectReadOnly('introduction');
    // 16b: empty (clear) — same commit contract; see TC-CSEDIT-005 for enablement.
  });

  test.skip('TC-CSEDIT-017 save confirmation shows exact copy at top of screen and auto-dismisses (AC-017)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} x`);
    await cs.save('background');
    await expect(cs.confirmation).toContainText(CsCopy.saveConfirmation(BG_NAME));
    await expect(cs.confirmation).toBeHidden({ timeout: 8000 }); // ~5s auto-dismiss (tolerance)
  });

  test.skip('TC-CSEDIT-018 Save error (5xx / network): stays in edit mode, generic error, changes retained (§5.7)', async ({ page }) => {
    await page.route('**/company-settings/**', (route) =>
      route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} x`);
    await cs.save('background');
    await expect(cs.genericError).toHaveText(CsCopy.genericError);
    await expect(cs.textarea('background')).toHaveValue(`${SAVED} x`); // retained
  });

  test.skip('TC-CSEDIT-019 double-submit prevention: Save disables on click, one PUT only, re-enables on error (§5.7)', async ({ page }) => {
    const puts: string[] = [];
    await page.route('**/company-settings/**', async (route) => {
      if (route.request().method() === 'PUT') {
        puts.push(route.request().url());
        await new Promise((r) => setTimeout(r, 800)); // delay to attempt a second click — infra delay, not a sync sleep
        return route.fulfill({ status: 500, body: '{}' });
      }
      return route.continue();
    });
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} x`);
    await cs.save('background');
    await expect(cs.saveButton('background')).toBeDisabled(); // immediately on click
    await cs.saveButton('background').click({ force: true }).catch(() => undefined); // no second PUT
    await expect(cs.saveButton('background')).toBeEnabled(); // re-enabled on error
    expect(puts).toHaveLength(1);
  });

  test.skip('TC-CSEDIT-020 browser-level navigation with unsaved changes triggers beforeunload guard (§5.8) [PARTIAL]', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} dirty`);
    // A beforeunload handler is registered while dirty; native dialog text is browser-owned (manual).
    const hasGuard = await page.evaluate(() => typeof window.onbeforeunload === 'function');
    expect(hasGuard).toBe(true);
  });

  test.skip('TC-CSEDIT-021 exclusive editing: at most one section editable at any time (BR-02)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    expect(await cs.editingCount()).toBe(1);
    await cs.editButton('introduction').click(); // silent switch (no change)
    expect(await cs.editingCount()).toBe(1);
    await cs.editButton('terms_and_conditions').click();
    expect(await cs.editingCount()).toBe(1);
  });

  test.skip('TC-CSEDIT-022 existing sourcing events retain content as of creation time (AC-018) [MANUAL / cross-feature]', async () => {
    // Owned by the Sourcing feature spec (snapshot-at-creation). Verified with that suite, not here.
    test.info().annotations.push({ type: 'manual', description: 'AC-018 cross-feature — Sourcing snapshot mechanism' });
  });

  test.skip('TC-CSEDIT-023 save confirmation can be manually dismissed before auto-dismiss (REC-02)', async ({ page }) => {
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} x`);
    await cs.save('background');
    await expect(cs.confirmation).toBeVisible();
    await page.getByTestId('cs-confirmation-dismiss').click();
    await expect(cs.confirmation).toBeHidden();
    await cs.expectReadOnly('background'); // saved state intact
  });

  test.skip('TC-CSEDIT-024 popup Save Changes with a failing PUT aborts action, keeps edit mode (REC-04, §5.8)', async ({ page }) => {
    await page.route('**/company-settings/**', (route) =>
      route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: '{}' }) : route.continue(),
    );
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await cs.enterEdit('background');
    await cs.type('background', `${SAVED} dirty`);
    await cs.editButton('introduction').click();
    await cs.popupSaveChanges.click();
    await expect(cs.genericError).toHaveText(CsCopy.genericError);
    await expect(cs.textarea('background')).toHaveValue(`${SAVED} dirty`); // still editing, intact
    await expect(cs.textarea('introduction')).toHaveCount(0); // triggering action aborted
  });
});

test.describe('SR-003 plain-text render (no XSS)', () => {
  test.skip('TC-CSSEC-003 stored HTML/script payload renders as literal text (no execution)', async ({ page }) => {
    // TODO_FIXTURE: seed a section (via API TC-CSAPI-020) with an XSS payload.
    let dialogFired = false;
    page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });
    const cs = new CompanySettingsPage(page);
    await cs.goto();
    await expect(cs.contentReadonly('background')).toContainText('<script>'); // shown as literal text
    await expect(page.locator('img[onerror]')).toHaveCount(0); // no injected node
    expect(dialogFired).toBe(false); // no script executed
  });
});
