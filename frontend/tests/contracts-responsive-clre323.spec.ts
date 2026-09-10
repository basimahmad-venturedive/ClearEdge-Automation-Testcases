/**
 * CLRE-323 — "contract screen is not responsive".
 *
 * The ticket carries only screenshots, so scope comes from the developer's two fix notes:
 *   fbb9be7 — Contract ID column wrapping on the Contracts table (desktop/tablet widths)
 *   0be3c1a — "stop mobile buttons/pagination clipping off-screen on Contracts", covering
 *             (1) the Contracts list pagination overflowing on mobile and
 *             (2) the Contract Detail page not being responsive on mobile
 *
 * Both are objectively measurable without guessing at a visual design: at a mobile width the
 * document must not scroll horizontally, and the interactive controls must sit inside the
 * viewport. That is asserted here rather than anything about spacing or aesthetics.
 */
import { test, expect, type Page } from '@playwright/test';
import { appBaseUrl } from '../utils/env';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;
const MOBILE = { width: 390, height: 844 };   // iPhone 12/13/14 class, the ticket's case
const TABLET = { width: 768, height: 1024 };

/** Horizontal overflow of the document itself — the defining symptom of "not responsive". */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    return Math.max(0, Math.max(d.scrollWidth, document.body.scrollWidth) - d.clientWidth);
  });
}

/** Elements whose box extends beyond the viewport's right edge, by testid where available. */
async function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const candidates = document.querySelectorAll<HTMLElement>(
      'button, a[role="button"], .ant-pagination, .ant-pagination-item, [data-testid]',
    );
    const inScrollableBox = (el: HTMLElement): boolean => {
      let n: HTMLElement | null = el.parentElement;
      while (n && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
        n = n.parentElement;
      }
      return false;
    };
    candidates.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;          // hidden
      if (getComputedStyle(el).visibility === 'hidden') return;
      // Wide content scrolling inside its own overflow-x container is correct design, not
      // clipping — a data table at 390px is expected to scroll sideways within its card.
      if (inScrollableBox(el)) return;
      if (r.right > vw + 1) {
        const id = el.getAttribute('data-testid') ?? el.className?.toString().slice(0, 40) ?? el.tagName;
        const label = (el.textContent ?? '').trim().slice(0, 30);
        out.push(`${id}${label ? ` ("${label}")` : ''} right=${Math.round(r.right)} > vw=${vw}`);
      }
    });
    return [...new Set(out)];
  });
}

test.describe('Contracts screens — responsiveness (CLRE-323)', () => {
  test('TC-CTUI-323-1 — the Contracts list does not overflow horizontally on mobile @regression', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(appUrl('/contracts'));
    await expect(page.getByRole('heading', { name: /^Contracts$/i })).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1500); // let the table settle after data lands

    const overflow = await horizontalOverflow(page);
    const clipped = await clippedControls(page);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-323] list @${MOBILE.width}px overflow=${overflow}px clippedControls=${clipped.length}`);
    for (const c of clipped.slice(0, 8)) console.log(`[CLRE-323]   ${c}`);

    expect(
      overflow,
      `the Contracts list scrolls horizontally by ${overflow}px at ${MOBILE.width}px wide — ` +
      `0be3c1a was meant to stop buttons/pagination clipping off-screen here`,
    ).toBe(0);
    expect(clipped, 'no control may sit outside the viewport at mobile width').toEqual([]);
  });

  // NOTE 2026-09-07: this was parked on 2026-09-06 as "no stable readiness anchor on the
  // detail screen". That was WRONG — the app publishes testids for this page in
  // lib/constants/contractTestIds.ts (rendered by ContractDetailView.tsx), and
  // `contract-detail-tabs-container` is the anchor I said did not exist. I had chased h1 /
  // anchors / .ant-table-row without checking the app's own testid constants. Unparked.
  test('TC-CTUI-323-2 — the Contract Detail page does not overflow horizontally on mobile @regression', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(appUrl('/contracts'));
    await expect(page.getByRole('heading', { name: /^Contracts$/i })).toBeVisible({ timeout: 45_000 });

    // Navigate by id rather than by clicking a row. Row markup on this screen is neither an
    // anchor nor an .ant-table-row, and at 390px it reflows again — chasing that DOM made
    // this case fail three times for reasons that had nothing to do with responsiveness.
    // Taking the id from the app's own API keeps the case about layout, not about selectors.
    // Read the token in the page, but make the API call from NODE via page.request: an
    // in-page fetch to the api-qa origin is CORS-blocked ("TypeError: Failed to fetch").
    const token = await page.evaluate(() => {
      const raw = window.localStorage.getItem('persist:ceiq-auth');
      if (!raw) return null;
      try { return JSON.parse(JSON.parse(raw).idToken as string) as string; } catch { return null; }
    });
    expect(token, 'no id token in localStorage').toBeTruthy();
    const apiBase = appBaseUrl().replace('//qa.', '//api-qa.').replace(/\/$/, '') + '/api/v1';
    const listed = await page.request.get(`${apiBase}/contracts?page=1&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listed.ok(), `contracts list failed: ${listed.status()}`).toBe(true);
    const familyId = (await listed.json())?.data?.contracts?.[0]?.familyId ?? null;
    expect(familyId, 'could not resolve a contract to open').toBeTruthy();

    await page.goto(appUrl(`/contracts/${familyId}`));
    // The page's own testid, published by the app for exactly this purpose.
    await expect(page.getByTestId('contract-detail-tabs-container')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('contract-detail-loading-skeleton')).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(2000);

    const overflow = await horizontalOverflow(page);
    const clipped = await clippedControls(page);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-323] detail @${MOBILE.width}px overflow=${overflow}px clippedControls=${clipped.length}`);
    for (const c of clipped.slice(0, 8)) console.log(`[CLRE-323]   ${c}`);

    expect(
      overflow,
      `the Contract Detail page scrolls horizontally by ${overflow}px at ${MOBILE.width}px wide — ` +
      `the second half of 0be3c1a's fix`,
    ).toBe(0);
    expect(clipped, 'no control may sit outside the viewport at mobile width').toEqual([]);
  });

  test('TC-CTUI-323-3 — the Contract ID column does not wrap at tablet width @regression', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await page.goto(appUrl('/contracts'));
    await expect(page.getByRole('heading', { name: /^Contracts$/i })).toBeVisible({ timeout: 45_000 });
    await page.waitForTimeout(1500);

    // fbb9be7's subject: CON-XXXX-NNN must render on one line, not broken across two.
    const wrapped = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll<HTMLElement>('td, .ant-table-cell'));
      const idCells = cells.filter((c) => /^\s*CON-\d{4}-\d{3}\s*$/.test(c.textContent ?? ''));
      const lineBoxes = (el: HTMLElement): number => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // Client rects are per rendered line box; coalesce by rounded top so a single line
        // split across inline nodes is not miscounted as two.
        const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        return tops.size;
      };
      return idCells
        .filter((c) => lineBoxes(c) > 1)
        .map((c) => (c.textContent ?? '').trim());
    });
    // eslint-disable-next-line no-console
    console.log(`[CLRE-323] wrapped Contract ID cells @${TABLET.width}px: ${wrapped.length}`);
    expect(wrapped, 'Contract ID must not wrap onto a second line').toEqual([]);
  });
});
