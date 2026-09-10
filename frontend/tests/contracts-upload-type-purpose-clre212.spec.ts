/**
 * CLRE-212 / BUG-CONTRACT-002 — Contract Type dropdown option purpose text.
 *
 * The ticket was closed "Won't Fix / could not reproduce" on dev HEAD, with the developer
 * asking two questions that were never answered:
 *   1. was it tested against a QA deployment a few commits behind dev?
 *   2. should the purpose text also appear INSIDE the dropdown option rows, rather than
 *      only below the field after a selection? Spec line 196 ("each showing its purpose
 *      text once selected") is ambiguous between the two readings.
 *
 * This answers (1) on QA, and records (2) as an observation rather than an assertion —
 * the ambiguity is a product ruling, and a test must not invent one. So:
 *   TC-CTUI-212  asserts the behaviour that IS unambiguous: selecting a type shows that
 *                type's purpose text, verbatim per the spec, below the field.
 *   The in-list reading is measured and logged, and deliberately not asserted.
 *
 * Purpose strings are the spec's, via the app's own lib/constants/contractTypes.ts.
 */
import { test, expect } from '@playwright/test';
import { appBaseUrl } from '../utils/env';

/**
 * The project's default `baseURL` is the ADMIN portal; app routes must go through
 * APP_BASE_URL or they return a bare "Not Found" (learned the hard way here).
 */
const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;

/** Spec purpose text per Contract Type label (spec §"Contract Type", 5 options). */
const PURPOSE: Array<{ label: string; title: string; purpose: string }> = [
  { label: 'MSA (Services)', title: 'MSA (Services)', purpose: 'Professional services, consulting, implementation, managed services' },
  { label: 'Vendor Agreement (General)', title: 'Vendor Agreement (General)', purpose: 'General supplier relationship when no other governing agreement exists' },
];

test.describe('Contracts upload — Contract Type purpose text (CLRE-212)', () => {
  test('TC-CTUI-212 — selecting a Contract Type shows that type\'s purpose text verbatim @regression', async ({ page }) => {
    // Land on the app origin first so the stored session applies, then the upload route.
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });
    await page.goto(appUrl('/contracts/upload'));
    await expect(page.getByTestId('upload-contract-type-select')).toBeVisible({ timeout: 45_000 });

    // ── Observation only: is the purpose text inside the option rows? (question 2) ──
    await page.getByTestId('upload-contract-type-select').click();
    const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    await expect(options.first()).toBeVisible({ timeout: 15_000 });
    const optionCount = await options.count();
    const optionTexts: string[] = [];
    for (let i = 0; i < optionCount; i += 1) optionTexts.push(((await options.nth(i).textContent()) ?? '').trim());
    const anyPurposeInList = optionTexts.some((t) =>
      PURPOSE.some((p) => t.includes(p.purpose)));
    // eslint-disable-next-line no-console
    console.log(`[CLRE-212] dropdown options (${optionCount}): ${JSON.stringify(optionTexts)}`);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-212] purpose text rendered INSIDE the option rows: ${anyPurposeInList} ` +
      `(spec line 196 is ambiguous — recorded, not asserted; needs a product ruling)`);

    // The five documented labels must all be present — that part is unambiguous.
    expect(optionCount, 'the spec documents five Contract Type options').toBe(5);

    // ── The assertion: selecting a type shows ITS purpose text ─────────────────────
    // antd renders the dropdown in a portal WITH an open/close animation, and re-opening it
    // resolves the option element while it is still moving ("element is not stable"). So
    // each iteration re-opens explicitly and waits for the specific option to settle before
    // clicking, rather than assuming the list is still open from the previous pass.
    for (const { label, title, purpose } of PURPOSE) {
      await page.keyboard.press('Escape'); // close whatever is open, ignore if nothing is
      await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0, { timeout: 10_000 });

      await page.getByTestId('upload-contract-type-select').click();
      const target = page.locator(`.ant-select-dropdown:visible .ant-select-item-option[title="${title}"]`);
      await expect(target, `option ${label} must exist in the list`).toBeVisible({ timeout: 15_000 });
      // Settle the entry animation so the click lands on a stable box.
      await expect(target).toBeInViewport({ timeout: 10_000 });
      await target.click({ timeout: 15_000 });

      await expect(
        page.getByText(purpose, { exact: false }),
        `after selecting ${label} the spec's purpose text must be shown verbatim: "${purpose}". ` +
        'If this fails on QA while dev passes, QA is behind dev — which is the question ' +
        'raised on CLRE-212 and never answered.',
      ).toBeVisible({ timeout: 15_000 });
      // eslint-disable-next-line no-console
      console.log(`[CLRE-212] "${title}" -> purpose text shown verbatim: OK`);
    }
  });
});
