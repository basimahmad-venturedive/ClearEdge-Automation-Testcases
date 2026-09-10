/**
 * CEIQ-FEAT-011 — Upcoming Renewals & Expirations and Active Sourcing Events:
 * row content, navigation, empty and error states, and the Month-view reflow.
 * Source: testcases/TC-CEIQ-FEAT-011.md — TC-DASHUI-058…071.
 *
 * Runs under the `po` project against QA. Read-only.
 *
 * Timezone is pinned to America/Chicago because `UpcomingRenewalsCard` formats
 * dates with `dayjs(item.expirationDate)` in LOCAL time. On an unpinned runner a
 * genuine off-by-one would appear or vanish depending on the machine's offset;
 * pinning makes the assertion mean what it says.
 */
import { test, expect, type Page } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';
import { DashboardCopy, DashboardApi } from './fixtures/expectedCopyDashboard';

test.use({ timezoneId: 'America/Chicago' });

interface RenewalItem {
  id: string;
  name: string;
  expirationDate: string;
  daysRemaining: number;
  badgeColor: 'red' | 'amber' | 'grey';
  badgeText: string;
  noticeDeadline: { date: string; label: string } | null;
}

interface SourcingItem {
  id: string;
  type: 'rfp' | 'rfq';
  title: string;
  submissionDeadline: string;
  daysUntilDeadline: number;
  relativeLabel: string;
}

/** `YYYY-MM-DD` → `MM/DD/YYYY`, the format both panels are specified to render. */
const usDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
};

async function failEndpoint(page: Page, glob: string): Promise<void> {
  await page.route(glob, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'ERR_INTERNAL', message: 'boom', details: {} } }),
    }),
  );
}

async function stubEndpoint(page: Page, glob: string, data: unknown): Promise<void> {
  await page.route(glob, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) }),
  );
}

test.describe('Dashboard — Upcoming Renewals & Expirations (US-DASH-003 AC-001)', () => {
  let dash: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dash = new DashboardPage(page);
  });

  test('TC-DASHUI-058 — the panel renders with its title, one row per item, and View All @smoke @regression', async () => {
    const data = await dash.gotoCapturing<{ contracts: RenewalItem[] }>(DashboardApi.renewals);
    await expect(dash.renewalsCard()).toBeVisible();
    await expect(dash.viewAll(dash.renewalsCard())).toBeVisible();
    if (data.contracts.length === 0) {
      await expect(dash.renewalsCard().getByText(DashboardCopy.renewals.empty, { exact: true })).toBeVisible();
    } else {
      await expect(dash.listRows(dash.renewalsCard())).toHaveCount(data.contracts.length);
    }
  });

  test('TC-DASHUI-059 — each row shows the name, badge and "expires MM/DD/YYYY CT" @smoke @regression', async () => {
    const data = await dash.gotoCapturing<{ contracts: RenewalItem[] }>(DashboardApi.renewals);
    test.skip(data.contracts.length === 0, 'BLOCKED — no qualifying contracts on this run');
    for (const [i, item] of data.contracts.entries()) {
      const text = ((await dash.listRows(dash.renewalsCard()).nth(i).textContent()) ?? '').trim();
      expect(text, `row ${i} name`).toContain(item.name);
      expect(text, `row ${i} badge`).toContain(item.badgeText);
      expect(text, `row ${i} expiry line`).toContain(`expires ${usDate(item.expirationDate)} CT`);
    }
  });

  test('TC-DASHUI-060 — the Notice Deadline line renders in the mandated format, or is omitted @regression', async () => {
    const data = await dash.gotoCapturing<{ contracts: RenewalItem[] }>(DashboardApi.renewals);
    test.skip(data.contracts.length === 0, 'BLOCKED — no qualifying contracts on this run');
    for (const [i, item] of data.contracts.entries()) {
      const text = ((await dash.listRows(dash.renewalsCard()).nth(i).textContent()) ?? '').trim();
      if (item.noticeDeadline) {
        expect(text, `row ${i} notice line`).toContain(
          `Notice deadline: ${item.noticeDeadline.label} · ${usDate(item.noticeDeadline.date)} CT`,
        );
      } else {
        expect(text, `row ${i} must omit the notice line entirely (EC-01)`).not.toContain('Notice deadline');
      }
    }
  });

  test('TC-DASHUI-061 — clicking a row opens that contract @regression', async ({ page }) => {
    const data = await dash.gotoCapturing<{ contracts: RenewalItem[] }>(DashboardApi.renewals);
    test.skip(data.contracts.length === 0, 'BLOCKED — no qualifying contracts on this run');
    await dash.listRows(dash.renewalsCard()).first().click();
    await expect(page).toHaveURL(new RegExp(`/contracts/${data.contracts[0]!.id}`));
  });

  test('TC-DASHUI-062 — "View All" opens Contracts filtered to Expiring Soon @regression', async ({ page }) => {
    await dash.goto();
    await dash.viewAll(dash.renewalsCard()).click();
    await expect(page).toHaveURL(/\/contracts\?status=expiring_soon/);
  });

  test('TC-DASHUI-067 — the empty state reads "No contracts expiring in the next 30 days" @regression', async ({ page }) => {
    await stubEndpoint(page, DashboardApi.renewals, { contracts: [] });
    await dash.goto();
    await expect(dash.renewalsCard().getByText(DashboardCopy.renewals.empty, { exact: true })).toBeVisible();
    await expect(dash.viewAll(dash.renewalsCard())).toBeVisible();
    await expect(dash.listRows(dash.renewalsCard())).toHaveCount(0);
  });

  test('TC-DASHUI-069 — a renewals failure shows the panel error, header and View All intact @regression', async ({ page }) => {
    await failEndpoint(page, DashboardApi.renewals);
    await dash.goto();
    const card = dash.renewalsCard();
    await expect(card.getByText(DashboardCopy.errors.panel.message, { exact: true })).toBeVisible();
    await expect(card.getByText(DashboardCopy.errors.panel.description, { exact: true })).toBeVisible();
    await expect(dash.viewAll(card)).toBeVisible();
    await expect(dash.listRows(card)).toHaveCount(0);
    // Isolation: the other widgets are unaffected.
    await expect(dash.activeSourcingCard()).toBeVisible();
    await expect(dash.errorAlert(dash.activeSourcingCard())).toHaveCount(0);
  });
});

test.describe('Dashboard — Active Sourcing Events (US-DASH-003 AC-002)', () => {
  let dash: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dash = new DashboardPage(page);
  });

  test('TC-DASHUI-063 — the panel renders with its title, one row per item, and View All @smoke @regression', async () => {
    const data = await dash.gotoCapturing<{ events: SourcingItem[] }>(DashboardApi.activeSourcing);
    await expect(dash.activeSourcingCard()).toBeVisible();
    await expect(dash.viewAll(dash.activeSourcingCard())).toBeVisible();
    if (data.events.length === 0) {
      await expect(dash.activeSourcingCard().getByText(DashboardCopy.activeSourcing.empty, { exact: true })).toBeVisible();
    } else {
      await expect(dash.listRows(dash.activeSourcingCard())).toHaveCount(data.events.length);
    }
  });

  test('TC-DASHUI-064 — each row shows the type badge, title, deadline and relative label, with no urgency colour @regression', async () => {
    const data = await dash.gotoCapturing<{ events: SourcingItem[] }>(DashboardApi.activeSourcing);
    test.skip(data.events.length === 0, 'BLOCKED — no active sourcing events on this run');
    for (const [i, item] of data.events.entries()) {
      const row = dash.listRows(dash.activeSourcingCard()).nth(i);
      const text = ((await row.textContent()) ?? '').trim();
      expect(text, `row ${i} type badge`).toContain(item.type.toUpperCase());
      expect(text, `row ${i} title`).toContain(item.title);
      expect(text, `row ${i} deadline`).toContain(`${usDate(item.submissionDeadline)} CT`);
      expect(text, `row ${i} relative label`).toContain(item.relativeLabel);
      // BR-03 — no urgency wording leaks in from the Renewals row component.
      expect(text, `row ${i} must carry no urgency badge`).not.toMatch(/\bd left\b|Expires today/);
    }
  });

  test('TC-DASHUI-065 — clicking a row opens that event @regression', async ({ page }) => {
    const data = await dash.gotoCapturing<{ events: SourcingItem[] }>(DashboardApi.activeSourcing);
    test.skip(data.events.length === 0, 'BLOCKED — no active sourcing events on this run');
    await dash.listRows(dash.activeSourcingCard()).first().click();
    await expect(page).toHaveURL(new RegExp(`/sourcing/${data.events[0]!.id}`));
  });

  test('TC-DASHUI-066 — "View All" opens Sourcing filtered to Active @regression', async ({ page }) => {
    await dash.goto();
    await dash.viewAll(dash.activeSourcingCard()).click();
    await expect(page).toHaveURL(/\/sourcing\?tab=active/);
  });

  test('TC-DASHUI-068 — the empty state reads "No active sourcing events" @regression', async ({ page }) => {
    await stubEndpoint(page, DashboardApi.activeSourcing, { events: [] });
    await dash.goto();
    await expect(dash.activeSourcingCard().getByText(DashboardCopy.activeSourcing.empty, { exact: true })).toBeVisible();
    await expect(dash.viewAll(dash.activeSourcingCard())).toBeVisible();
  });

  test('TC-DASHUI-070 — an Active Sourcing failure is isolated from its twin panel @regression', async ({ page }) => {
    await failEndpoint(page, DashboardApi.activeSourcing);
    await dash.goto();
    const card = dash.activeSourcingCard();
    await expect(card.getByText(DashboardCopy.errors.panel.message, { exact: true })).toBeVisible();
    await expect(card.getByText(DashboardCopy.errors.panel.description, { exact: true })).toBeVisible();
    await expect(dash.viewAll(card)).toBeVisible();
    // The Renewals panel — the visual twin — must render its own data normally.
    await expect(dash.errorAlert(dash.renewalsCard())).toHaveCount(0);
  });
});

test.describe('Dashboard — responsive reflow (US-DASH-003 AC-004; Tech §6.4)', () => {
  test('TC-DASHUI-071 — in Month view both panels reflow below the calendar, content unchanged @regression', async ({ page }) => {
    const dash = new DashboardPage(page);
    await dash.goto();

    // Compare row counts and the first row's text, not the whole card's textContent:
    // the panels remount into a different Row on reflow, and a card-level string also
    // picks up scrollbar-dependent whitespace, which makes a correct reflow look like
    // a content change.
    // `.first().textContent()` BLOCKS until the element exists, so on an empty panel it burns the
    // whole test timeout instead of reporting "no rows". Renewals is genuinely empty on QA
    // ("Expiring in 30 days: 0"), so read the row only when one is actually there.
    const firstRowText = async (card: ReturnType<typeof dash.renewalsCard>) => {
      const rows = dash.listRows(card);
      if ((await rows.count()) === 0) return '';
      return ((await rows.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
    };
    const rowSnapshot = async () => ({
      renewals: await dash.listRows(dash.renewalsCard()).count(),
      sourcing: await dash.listRows(dash.activeSourcingCard()).count(),
      firstRenewal: await firstRowText(dash.renewalsCard()),
      firstSourcing: await firstRowText(dash.activeSourcingCard()),
    });
    // Settle before snapshotting — capturing mid-skeleton records zero rows and then reports a
    // correct reflow as a content change. Wait for the skeleton to clear rather than for a ROW to
    // appear: a panel is legitimately empty when the data is empty. On 2026-09-10 QA showed
    // "Expiring in 30 days: 0", so Renewals had no rows and the old row-guard failed a test that
    // is about LAYOUT, not content. Reflow is just as checkable on an empty panel.
    await dash.waitForPanelsSettled();
    const before = await rowSnapshot();
    const listBox = await dash.renewalsCard().boundingBox();
    const calListBox = await dash.calendarCard().boundingBox();
    expect(listBox && calListBox).toBeTruthy();
    // In List view the panel sits beside the calendar: their vertical spans overlap.
    expect(listBox!.y, 'in List view the Renewals panel should sit beside the calendar').toBeLessThan(
      calListBox!.y + calListBox!.height,
    );

    await dash.goToMonthView();
    // Wait for the remounted panels to finish rendering before measuring or comparing.
    await dash.waitForPanelsSettled();

    const calMonthBox = await dash.calendarCard().boundingBox();
    const renewalsBox = await dash.renewalsCard().boundingBox();
    const sourcingBox = await dash.activeSourcingCard().boundingBox();
    expect(calMonthBox && renewalsBox && sourcingBox).toBeTruthy();

    expect(renewalsBox!.y, 'in Month view the Renewals panel must sit BELOW the calendar').toBeGreaterThanOrEqual(
      calMonthBox!.y + calMonthBox!.height - 8,
    );
    expect(sourcingBox!.y, 'in Month view the Active Sourcing panel must sit BELOW the calendar').toBeGreaterThanOrEqual(
      calMonthBox!.y + calMonthBox!.height - 8,
    );
    // …and side by side with each other.
    expect(Math.abs(renewalsBox!.y - sourcingBox!.y), 'the two panels should share a row below the calendar').toBeLessThan(40);

    expect(await rowSnapshot(), 'panel content changed on reflow').toEqual(before);
  });
});
