/**
 * CLRE-383 — "Contract: Button displaced on contract view screen".
 *
 * The ticket has no description, so scope comes from the fix, ae71e1c "keep contract header
 * actions right-aligned when wrapped": PageHeader's action <Space> sat in a flex row with
 * justifyContent: space-between, which only distributes space while the row has more than one
 * child on it — once the actions wrapped onto their own line they fell to the LEFT. The fix
 * adds marginLeft: auto so they stay right-aligned on their own line.
 *
 * Asserted geometrically rather than by style: at a width that forces the wrap, the action
 * group's right edge must line up with the header's right edge, and the group must not be
 * sitting at the header's left edge. That is checkable without judging the design.
 */
import { test, expect, type Page } from '@playwright/test';
import { appBaseUrl } from '../utils/env';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;
/** Wide enough that the page is not in mobile layout, narrow enough to force the wrap. */
const WRAP_WIDTH = { width: 860, height: 900 };

async function firstFamilyId(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const raw = window.localStorage.getItem('persist:ceiq-auth');
    if (!raw) return null;
    try { return JSON.parse(JSON.parse(raw).idToken as string) as string; } catch { return null; }
  });
  expect(token, 'no id token in localStorage').toBeTruthy();
  const apiBase = `${appBaseUrl().replace('//qa.', '//api-qa.').replace(/\/$/, '')}/api/v1`;
  // Scan several pages: on QA the NEWEST rows are families the detail endpoint 404s for
  // (observed 2026-09-08 — the 10 most recent all returned ERR_CONTRACT_NOT_FOUND, raised
  // separately), so a single page of the newest contracts can yield nothing openable.
  const rows: Array<{ familyId: string }> = [];
  for (let pg = 1; pg <= 4; pg += 1) {
    const r = await page.request.get(`${apiBase}/contracts?page=${pg}&limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.ok(), `contracts list failed: ${r.status()}`).toBe(true);
    const batch = (await r.json())?.data?.contracts ?? [];
    if (!batch.length) break;
    rows.push(...batch);
  }
  expect(rows.length, 'no contracts available to open').toBeGreaterThan(0);

  // Take the first family the DETAIL endpoint actually resolves. The newest row is often a
  // contract a previous automated run created and then deleted, and the list can still
  // return it — navigating to it lands on "Contract not found" and the case fails for a
  // reason that has nothing to do with layout (observed 2026-09-08).
  for (const row of rows) {
    const d = await page.request.get(`${apiBase}/contracts/${row.familyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (d.ok()) return row.familyId;
  }
  throw new Error(`none of ${rows.length} contracts resolved on GET /contracts/:familyId — see the list-vs-detail 404 finding of 2026-09-08`);
}

test.describe('Contract detail — header action alignment (CLRE-383)', () => {
  test('TC-CTUI-383 — header actions stay right-aligned when they wrap onto their own line @regression', async ({ page }) => {
    await page.setViewportSize(WRAP_WIDTH);
    await page.goto(appUrl('/dashboard'));
    const familyId = await firstFamilyId(page);

    await page.goto(appUrl(`/contracts/${familyId}`));
    await expect(page.getByTestId('contract-detail-tabs-container')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('contract-detail-loading-skeleton')).toHaveCount(0, { timeout: 60_000 });

    // Which header actions render depends on the contract's state — Upload New Version is
    // hidden for Active contracts, for instance — so take whichever of the four exists
    // rather than assuming one. A fixed choice found nothing on the first run.
    const ACTIONS = [
      'contract-detail-upload-new-version-button',
      'contract-detail-update-contract-button',
      'contract-detail-terminate-button',
      'contract-detail-delete-button',
    ];
    const present: string[] = [];
    for (const id of ACTIONS) if (await page.getByTestId(id).count()) present.push(id);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-383] header actions present: ${JSON.stringify(present)}`);
    expect(present, 'the contract header rendered none of its four action buttons').not.toEqual([]);
    const anyAction = page.getByTestId(present[0]!);
    await expect(anyAction.first()).toBeVisible({ timeout: 30_000 });

    const geom = await anyAction.first().evaluate((el) => {
      // Walk UP through every .ant-space ancestor, not just the nearest. The fix puts
      // marginLeft:auto on PageHeader's OUTER extra <Space>, while the buttons themselves
      // sit in a nested <Space> — so closest() returns the inner one and the fix looks
      // absent. Prefer the outermost Space that carries the inline margin.
      let group = el.closest('.ant-space') as HTMLElement | null;
      if (!group) return null;
      let scan: HTMLElement | null = group;
      const spaces: HTMLElement[] = [];
      while (scan) {
        if (scan.classList.contains('ant-space')) spaces.push(scan);
        scan = scan.parentElement;
      }
      group = spaces.find((sp) => sp.style.marginLeft === 'auto') ?? spaces[spaces.length - 1] ?? group;
      // The header row is the group's flex parent; compare against its content box so
      // padding is not mistaken for misalignment.
      const row = group.parentElement as HTMLElement;
      const rowBox = row.getBoundingClientRect();
      const rowStyle = getComputedStyle(row);
      const padLeft = parseFloat(rowStyle.paddingLeft) || 0;
      const padRight = parseFloat(rowStyle.paddingRight) || 0;
      const g = group.getBoundingClientRect();
      return {
        wrapped: g.top >= rowBox.top + g.height * 0.5,   // sitting on its own line, below the title
        groupLeft: Math.round(g.left), groupRight: Math.round(g.right),
        contentLeft: Math.round(rowBox.left + padLeft), contentRight: Math.round(rowBox.right - padRight),
        marginLeft: getComputedStyle(group).marginLeft,
        inlineMarginLeft: group.style.marginLeft,
      };
    });
    expect(geom, 'could not locate the header action group (.ant-space)').not.toBeNull();
    const g = geom!;
    // eslint-disable-next-line no-console
    console.log(`[CLRE-383] wrapped=${g.wrapped} group=[${g.groupLeft},${g.groupRight}] content=[${g.contentLeft},${g.contentRight}] marginLeft=${g.marginLeft}`);

    // Right edges must line up (a few px of tolerance for borders/rounding).
    expect(
      Math.abs(g.groupRight - g.contentRight),
      `header actions are not right-aligned: group right edge ${g.groupRight} vs content right edge ` +
      `${g.contentRight}. ae71e1c adds marginLeft:auto so the group stays right-aligned even when ` +
      `it wraps onto its own line — this is the "displaced button" in CLRE-383.`,
    ).toBeLessThanOrEqual(4);

    // The fix's actual mechanism, mirroring the unit test added in ae71e1c which asserts
    // toHaveStyle({ marginLeft: "auto" }): the Space must carry marginLeft:auto so it stays
    // right-aligned once it is alone on its line. Asserted from the INLINE style, because
    // computed marginLeft resolves "auto" to 0px whenever the group already fills its row —
    // which is the case at this width, and is why geometry alone cannot see the fix. An
    // earlier "must not be flush left" assertion was dropped: it is invalid when the group
    // spans the full content width, which it does here, and it failed for that reason
    // despite the right edges lining up exactly.
    expect(
      g.inlineMarginLeft,
      'the header action group does not carry marginLeft:auto — without it the group falls to ' +
      'the LEFT once it wraps onto its own line, which is the displaced button in CLRE-383',
    ).toBe('auto');
  });
});
