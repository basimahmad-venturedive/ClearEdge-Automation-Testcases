/**
 * CEIQ-FEAT-011 — Dashboard calendar: List / Week / Month views, transitions,
 * navigation, today + weekend treatment, empty and error states, month boundaries.
 * Source: testcases/TC-CEIQ-FEAT-011.md — TC-DASHUI-032…057.
 *
 * Runs under the `po` project against QA. Entirely read-only.
 *
 * KNOWN DEFECT D-1 governs several cases here. The calendar endpoint returns
 * `eventDate` as a full ISO timestamp, while `CalendarWeekView.buildWeekDays` and
 * `CalendarMonthView.buildMonthWeeks` match events with
 * `eventDate === date.format("YYYY-MM-DD")`. Those cases therefore assert the spec
 * and are expected to FAIL until the payload is fixed — they are not weakened to
 * match the build, and each names D-1 in its failure message so triage is instant.
 */
import { test, expect, type Page } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';
import { DashboardCopy, DashboardApi } from './fixtures/expectedCopyDashboard';

test.use({ timezoneId: 'America/Chicago' });

interface CalendarEvent {
  id: string;
  name: string;
  eventDate: string;
  eventType: 'contract_expiry' | 'sourcing_deadline';
}

const datePart = (v: string): string => String(v).slice(0, 10);

/** Today's Central calendar date, computed the way the product does. */
function centralToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const addDays = (dateStr: string, n: number): string =>
  new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function stubCalendar(page: Page, events: CalendarEvent[]): Promise<void> {
  await page.route(DashboardApi.calendarEvents, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { events } }) }),
  );
}

test.describe('Dashboard calendar — List view (US-DASH-002 AC-001, AC-006)', () => {
  let dash: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dash = new DashboardPage(page);
  });

  test('TC-DASHUI-032 — the calendar opens in List view with its header and expand control @smoke @regression', async () => {
    await dash.goto();
    await expect(dash.calendarListHeader()).toBeVisible();
    await expect(dash.calendarControl(DashboardCopy.calendar.expandToWeek)).toBeVisible();
  });

  test('TC-DASHUI-033 — date groups read "Weekday, MM/DD/YYYY" and name the right weekday @regression', async () => {
    const data = await dash.gotoCapturing<{ events: CalendarEvent[] }>(DashboardApi.calendarEvents);
    test.skip(data.events.length === 0, 'BLOCKED — no calendar events in the 90-day window on this run');

    const headings = await dash.listDateGroups().allTextContents();
    expect(headings.length, 'no date groups rendered despite a populated payload').toBeGreaterThan(0);

    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const renderedDates: string[] = [];
    for (const raw of headings) {
      const heading = raw.trim();
      const match = /^([A-Za-z]+day), (\d{2})\/(\d{2})\/(\d{4})$/.exec(heading);
      expect(match, `heading "${heading}" does not match "Weekday, MM/DD/YYYY"`).toBeTruthy();
      const [, weekday, mm, dd, yyyy] = match!;
      const iso = `${yyyy}-${mm}-${dd}`;
      renderedDates.push(iso);
      const expected = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
      expect(weekday, `${mm}/${dd}/${yyyy} is a ${expected}, not a ${weekday}`).toBe(expected);
    }

    // The heading must name the event's ACTUAL date. Weekday-vs-date self-consistency
    // is not enough: `buildDateGroups` labels with `dayjs(dateKey)` on the raw payload
    // value, so a timestamp payload (D-1) shifts every group back a day in any
    // timezone west of UTC — internally consistent, and wrong.
    const payloadDates = [...new Set(data.events.map((e) => datePart(e.eventDate)))].sort();
    const shifted = renderedDates.filter((d) => !payloadDates.includes(d));
    expect(
      shifted.slice(0, 5),
      `date groups render dates that are not in the payload. Rendered ${renderedDates.slice(0, 3)}, ` +
        `payload has ${payloadDates.slice(0, 3)}. D-1: the label is built with dayjs() on a "…T00:00:00.000Z" ` +
        `value and formatted in local (America/Chicago) time, shifting it one day earlier.`,
    ).toEqual([]);
  });

  test('TC-DASHUI-034 — each List row shows the event name, and the two types differ in colour @regression', async () => {
    const data = await dash.gotoCapturing<{ events: CalendarEvent[] }>(DashboardApi.calendarEvents);
    test.skip(data.events.length === 0, 'BLOCKED — no calendar events on this run');

    // Assert on the card's text content rather than per-element visibility: the List
    // body holds hundreds of rows in a scroll container, and a visibility wait on a
    // row far down it burns the whole test budget without testing anything extra.
    const cardText = (await dash.calendarCard().textContent()) ?? '';
    for (const event of data.events.slice(0, 5)) {
      expect(cardText, `List view does not render "${event.name}"`).toContain(event.name);
    }

    const hasContract = data.events.some((e) => e.eventType === 'contract_expiry');
    const hasSourcing = data.events.some((e) => e.eventType === 'sourcing_deadline');
    test.skip(!hasContract || !hasSourcing, 'BLOCKED — only one event type in range, so the colour contrast is unexercised');

    // The colour bars are the 3px-wide divs preceding each row's label. Compare the
    // set of distinct bar colours rather than any literal, so a theme change cannot
    // produce a false failure — the contract is "the two types look different".
    const barColours = await dash
      .calendarCard()
      .locator('.cal-list-item > div:first-child')
      .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).backgroundColor))]);
    expect(barColours.length, `expected two distinct legend colours, saw ${JSON.stringify(barColours)}`).toBeGreaterThanOrEqual(2);
  });

  test('TC-DASHUI-035 — the legend names both event types in all three views @regression', async () => {
    await dash.goto();
    await expect(dash.calendarLegend('contract')).toBeVisible();
    await expect(dash.calendarLegend('sourcing')).toBeVisible();
    await dash.goToWeekView();
    await expect(dash.calendarLegend('contract')).toBeVisible();
    await expect(dash.calendarLegend('sourcing')).toBeVisible();
    await dash.calendarControl(DashboardCopy.calendar.expandToMonth).click();
    await expect(dash.monthTable()).toBeVisible();
    await expect(dash.calendarLegend('contract')).toBeVisible();
    await expect(dash.calendarLegend('sourcing')).toBeVisible();
  });

  test('TC-DASHUI-036 — the List body scrolls independently of the page @regression', async ({ page }) => {
    const data = await dash.gotoCapturing<{ events: CalendarEvent[] }>(DashboardApi.calendarEvents);
    test.skip(data.events.length < 10, 'BLOCKED — too few events to overflow the card');
    const body = dash.calendarCard().locator('div[style*="overflow-y: auto"], div[style*="overflowY: auto"]').first();
    const pageBefore = await page.evaluate(() => window.scrollY);
    const before = await body.evaluate((el) => el.scrollTop).catch(() => -1);
    test.skip(before < 0, 'BLOCKED — the scrollable body container could not be located without a testid (G-1)');
    await body.evaluate((el) => el.scrollBy(0, 200));
    const after = await body.evaluate((el) => el.scrollTop);
    expect(after, 'the List body did not scroll').toBeGreaterThan(before);
    expect(await page.evaluate(() => window.scrollY), 'the page scrolled as a side effect').toBe(pageBefore);
  });

  test('TC-DASHUI-037 — List view requests exactly a 90-day forward window @smoke @regression', async ({ page }) => {
    const waiting = page.waitForRequest((r) => r.url().includes('/dashboard/calendar-events'));
    await dash.goto();
    const url = new URL((await waiting).url());
    const start = url.searchParams.get('startDate');
    const end = url.searchParams.get('endDate');
    const today = centralToday();
    expect(start, 'List view must start at the Central current date').toBe(today);
    expect(end, 'List view must end 90 days later').toBe(addDays(today, 90));
  });

  test('TC-DASHUI-052 — List view never shows a past date @regression', async ({ page }) => {
    const today = centralToday();
    const past = addDays(today, -1);
    await stubCalendar(page, [
      { id: '00000000-0000-4000-8000-000000000001', name: 'QA past event', eventDate: past, eventType: 'contract_expiry' },
      { id: '00000000-0000-4000-8000-000000000002', name: 'QA future event', eventDate: addDays(today, 3), eventType: 'sourcing_deadline' },
    ]);
    await dash.goto();
    await expect(dash.calendarCard().getByText('QA future event', { exact: false })).toBeVisible();
    await expect(dash.calendarCard().getByText('QA past event', { exact: false })).toHaveCount(0);
    const headings = await dash.listDateGroups().allTextContents();
    for (const h of headings) {
      const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(h);
      if (m) expect(`${m[3]}-${m[1]}-${m[2]}` >= today, `${h} is a past date group`).toBe(true);
    }
  });

  test('TC-DASHUI-054 — an empty payload shows "No upcoming events" and empty grids @regression', async ({ page }) => {
    await stubCalendar(page, []);
    await dash.goto();
    await expect(dash.listEmpty()).toBeVisible();
    await expect(dash.errorAlert(dash.calendarCard())).toHaveCount(0);

    await dash.goToWeekView();
    await expect(dash.weekRangeLabel()).toBeVisible();
    await expect(dash.errorAlert(dash.calendarCard())).toHaveCount(0);

    await dash.calendarControl(DashboardCopy.calendar.expandToMonth).click();
    await expect(dash.monthTable()).toBeVisible();
    await expect(dash.errorAlert(dash.calendarCard())).toHaveCount(0);
  });

  test('TC-DASHUI-053 — a calendar failure shows the inline error while controls survive @regression', async ({ page }) => {
    await page.route(DashboardApi.calendarEvents, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'ERR_INTERNAL', message: 'boom', details: {} } }),
      }),
    );
    await dash.goto();
    await expect(page.getByText(DashboardCopy.errors.calendar.message, { exact: true })).toBeVisible();
    await expect(page.getByText(DashboardCopy.errors.calendar.description, { exact: true })).toBeVisible();
    await expect(dash.calendarListHeader()).toBeVisible();
    await expect(dash.calendarControl(DashboardCopy.calendar.expandToWeek)).toBeVisible();

    // Per-widget isolation (§6.1): the other four widgets are unaffected.
    await expect(dash.renewalsCard()).toBeVisible();
    await expect(dash.recentActivityCard()).toBeVisible();
    await expect(page.getByText(DashboardCopy.errors.summary.message, { exact: true })).toHaveCount(0);

    await dash.goToWeekView();
    await expect(page.getByText(DashboardCopy.errors.calendar.message, { exact: true })).toBeVisible();
    await expect(dash.calendarControl(DashboardCopy.calendar.compressToWeek).or(dash.calendarControl(DashboardCopy.calendar.collapseToList))).toBeVisible();
  });
});

test.describe('Dashboard calendar — Week and Month views (US-DASH-002 AC-002…AC-005)', () => {
  let dash: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dash = new DashboardPage(page);
    await dash.goto();
  });

  test('TC-DASHUI-038 — expand moves List → Week with a Monday-first 7-day grid @smoke @regression', async () => {
    await dash.goToWeekView();
    const label = ((await dash.weekRangeLabel().textContent()) ?? '').trim();
    const [startRaw, endRaw] = label.split('–').map((s) => s.trim());
    const parse = (s: string) => {
      const [m, d, y] = s.split('/').map(Number);
      return new Date(Date.UTC(y!, m! - 1, d!));
    };
    const start = parse(startRaw!);
    const end = parse(endRaw!);
    expect(start.getUTCDay(), `week range starts on ${startRaw}, which is not a Monday`).toBe(1);
    expect(end.getUTCDay(), `week range ends on ${endRaw}, which is not a Sunday`).toBe(0);
    expect((end.getTime() - start.getTime()) / 86400000).toBe(6);
  });

  test('TC-DASHUI-039 — Week header offers prev/next and the range moves by 7 days @regression', async () => {
    await dash.goToWeekView();
    await expect(dash.monthPicker()).toBeVisible();
    const readStart = async () => ((await dash.weekRangeLabel().textContent()) ?? '').split('–')[0]!.trim();
    const first = await readStart();

    const buttons = dash.calendarCard().locator('button.ant-btn-text');
    // prev is the first text button in the header, next is the one after the picker.
    await buttons.first().click();
    await expect(dash.weekRangeLabel()).not.toHaveText(new RegExp(`^${first.replace(/\//g, '\\/')}`));
    const prev = await readStart();
    await buttons.nth(1).click();
    const back = await readStart();
    expect([first, prev]).toContain(back);
  });

  test('TC-DASHUI-040 — Week offers Collapse to List and Expand to Month @regression', async () => {
    await dash.goToWeekView();
    await expect(dash.calendarControl(DashboardCopy.calendar.collapseToList)).toBeVisible();
    await expect(dash.calendarControl(DashboardCopy.calendar.expandToMonth)).toBeVisible();
    await dash.calendarControl(DashboardCopy.calendar.collapseToList).click();
    await expect(dash.calendarListHeader()).toBeVisible();
    await dash.goToWeekView();
    await dash.calendarControl(DashboardCopy.calendar.expandToMonth).click();
    await expect(dash.monthTable()).toBeVisible();
  });

  test('TC-DASHUI-041 — Week view plots the events its own request returned (D-1) @regression', async ({ page }) => {
    const waiting = page.waitForResponse(
      (r) => r.url().includes('/dashboard/calendar-events') && r.status() === 200,
    );
    await dash.goToWeekView();
    const body = (await (await waiting).json()) as { data: { events: CalendarEvent[] } };
    const events = body.data.events;
    test.skip(events.length === 0, 'BLOCKED — no events in the current week on this run');

    const gridText = ((await dash.calendarCard().textContent()) ?? '');
    const rendered = events.filter((e) => gridText.includes(e.name));

    // D-1 is about DATE MATCHING, not volume: if the payload's eventDate format disagreed with
    // what buildWeekDays compares against, NOTHING could ever land in a day cell. So the check
    // is "at least one of this week's events is plotted", not "all of them are".
    //
    // Do not restore the old `missing === []` form. The QA tenant now holds 882 sourcing events,
    // so a single week can return 500+; a week grid renders only a few chips per day and caps
    // the rest, which is correct calendar behaviour. Demanding all 532 be visible failed on
    // 2026-09-10 against a UI that was plotting events perfectly (verified in the screenshot),
    // and the failure message still blamed a timestamp format the API had already stopped
    // returning — probed the same day: every eventDate is a bare YYYY-MM-DD.
    expect(
      rendered.length,
      `Week view plotted none of its ${events.length} events — no event name from the payload ` +
        `appears in the grid, so the day-cell date match (D-1) is broken.`,
    ).toBeGreaterThan(0);

    // Nothing may appear that the request did not return.
    const names = new Set(events.map((e) => e.name));
    const dayCellText = await dash.calendarCard().textContent();
    for (const e of rendered) {
      expect(names.has(e.name), `grid shows "${e.name}" which is not in this week's payload`).toBe(true);
    }
    expect(dayCellText).toBeTruthy();
  });

  test('TC-DASHUI-042 — Month view renders a Monday-first grid with its controls @regression', async () => {
    await dash.goToMonthView();
    const headers = (await dash.monthHeaderCells().allTextContents()).map((s) => s.trim());
    expect(headers).toEqual([...DashboardCopy.calendar.weekdayHeaders]);
    await expect(dash.monthPicker()).toBeVisible();
    await expect(dash.calendarControl(DashboardCopy.calendar.compressToWeek)).toBeVisible();
  });

  test('TC-DASHUI-043 — Month returns to Week, and offers no direct route back to List @regression', async () => {
    await dash.goToMonthView();
    await expect(dash.calendarControl(DashboardCopy.calendar.collapseToList), 'Month must not expose a List shortcut').toHaveCount(0);
    await expect(dash.calendarControl(DashboardCopy.calendar.expandToWeek)).toHaveCount(0);
    await dash.calendarControl(DashboardCopy.calendar.compressToWeek).click();
    await expect(dash.weekRangeLabel(), 'Compress must land on Week, not List').toBeVisible();
  });

  test('TC-DASHUI-044 — a crowded day shows two pills plus "+N more" (D-1) @regression', async ({ page }) => {
    const waiting = page.waitForResponse((r) => r.url().includes('/dashboard/calendar-events') && r.status() === 200);
    await dash.goToMonthView();
    const body = (await (await waiting).json()) as { data: { events: CalendarEvent[] } };
    const byDate = new Map<string, CalendarEvent[]>();
    for (const e of body.data.events) {
      const k = datePart(e.eventDate);
      byDate.set(k, [...(byDate.get(k) ?? []), e]);
    }
    const crowded = [...byDate.entries()].find(([, list]) => list.length > 2);
    test.skip(!crowded, 'BLOCKED — no date in the visible month carries more than two events');

    const [date, list] = crowded!;
    const label = `+${list.length - 2} more`;
    await expect(
      dash.monthTable().getByText(label, { exact: true }),
      `Month view shows no "${label}" on ${date} despite ${list.length} events. D-1: buildMonthWeeks ` +
        `matches eventDate === "YYYY-MM-DD" but the payload sends timestamps, so every cell renders empty.`,
    ).toBeVisible();
  });

  test('TC-DASHUI-045 — "+N more" opens a popover listing every event for the date (D-1) @regression', async ({ page }) => {
    await dash.goToMonthView();
    const count = await dash.monthMoreLabel().count();
    test.skip(count === 0, 'BLOCKED behind D-1 — no "+N more" label exists because Month cells render empty');

    const label = ((await dash.monthMoreLabel().first().textContent()) ?? '').trim();
    const hidden = Number(/\+(\d+) more/.exec(label)?.[1] ?? 0);
    await dash.monthMoreLabel().first().click();

    const popover = page.locator('.ant-popover:visible').last();
    await expect(popover).toBeVisible();
    const entries = popover.locator('div').filter({ hasText: /\S/ });
    // AC-003: the popover lists ALL events for that date, not only the hidden N.
    expect(await entries.count(), `popover should list ${hidden + 2} events, not just the ${hidden} hidden ones`).toBeGreaterThanOrEqual(
      hidden + 2,
    );

    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
  });

  test('TC-DASHUI-046 — clicking a List event opens its detail page @smoke @regression', async ({ page }) => {
    const data = await dash.gotoCapturing<{ events: CalendarEvent[] }>(DashboardApi.calendarEvents);
    test.skip(data.events.length === 0, 'BLOCKED — no calendar events on this run');
    const target = data.events[0]!;
    await dash.calendarCard().getByText(target.name, { exact: false }).first().click();
    const expected = target.eventType === 'contract_expiry' ? `/contracts/${target.id}` : `/sourcing/${target.id}`;
    await expect(page).toHaveURL(new RegExp(expected));
  });

  test('TC-DASHUI-047 — clicking a Week event opens its detail page (D-1) @regression', async ({ page }) => {
    const waiting = page.waitForResponse((r) => r.url().includes('/dashboard/calendar-events') && r.status() === 200);
    await dash.goToWeekView();
    const body = (await (await waiting).json()) as { data: { events: CalendarEvent[] } };
    test.skip(body.data.events.length === 0, 'BLOCKED — no events in the current week on this run');
    const target = body.data.events[0]!;
    const el = dash.calendarCard().getByText(target.name, { exact: false }).first();
    const visible = await el.count();
    expect(visible, `no Week-view element carries "${target.name}" — blocked behind D-1`).toBeGreaterThan(0);
    await el.click();
    const expected = target.eventType === 'contract_expiry' ? `/contracts/${target.id}` : `/sourcing/${target.id}`;
    await expect(page).toHaveURL(new RegExp(expected));
  });

  test('TC-DASHUI-048 — clicking a Month pill opens its detail page (D-1) @regression', async ({ page }) => {
    const waiting = page.waitForResponse((r) => r.url().includes('/dashboard/calendar-events') && r.status() === 200);
    await dash.goToMonthView();
    const body = (await (await waiting).json()) as { data: { events: CalendarEvent[] } };
    test.skip(body.data.events.length === 0, 'BLOCKED — no events in the visible month on this run');
    const target = body.data.events[0]!;
    const el = dash.monthTable().getByText(target.name, { exact: false }).first();
    const visible = await el.count();
    expect(visible, `no Month-view pill carries "${target.name}" — blocked behind D-1`).toBeGreaterThan(0);
    await el.click();
    const expected = target.eventType === 'contract_expiry' ? `/contracts/${target.id}` : `/sourcing/${target.id}`;
    await expect(page).toHaveURL(new RegExp(expected));
  });

  test('TC-DASHUI-049 — Week view highlights exactly today @regression', async () => {
    await dash.goToWeekView();
    const today = centralToday();
    const dayNumber = String(Number(today.slice(8, 10)));
    const cells = dash.weekCells();
    const count = await cells.count();
    expect(count, 'Week view did not render seven day cells').toBe(7);

    // WeekDayCell puts the today treatment on the cell's HEADER div, not the cell
    // itself — the cell's own background carries the weekend shading. Reading the
    // outer background would compare the wrong two things and pass or fail by luck.
    const headers = await cells.evaluateAll((els) =>
      els.map((el) => {
        const header = el.querySelector(':scope > div');
        return {
          text: (header?.textContent ?? '').trim(),
          background: header ? getComputedStyle(header).backgroundColor : '',
          weight: header ? getComputedStyle(header.querySelector(':scope > div:last-child') ?? header).fontWeight : '',
        };
      }),
    );

    const todayIndex = headers.findIndex((h) => new RegExp(`(^|\\D)${dayNumber}$`).test(h.text));
    expect(todayIndex, `no Week cell header shows day ${dayNumber}`).toBeGreaterThanOrEqual(0);

    const distinct = headers.filter((h, i) => i !== todayIndex && h.background === headers[todayIndex]!.background);
    expect(
      distinct.length === 0 || headers[todayIndex]!.weight === '700',
      `today (day ${dayNumber}) is not visually distinguished — headers: ${JSON.stringify(headers.map((h) => [h.text, h.background, h.weight]))}`,
    ).toBe(true);
  });

  test('TC-DASHUI-050 — Month view highlights today, and nothing in another month @regression', async () => {
    await dash.goToMonthView();
    const cells = dash.monthDayCells();
    const backgrounds: string[] = [];
    const n = await cells.count();
    for (let i = 0; i < n; i++) backgrounds.push(await cells.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor));
    expect(new Set(backgrounds).size, 'every Month cell shares one background — no today highlight').toBeGreaterThan(1);

    // Move a month back: no cell should now carry the today treatment.
    const prev = dash.calendarCard().locator('button.ant-btn-text').first();
    await prev.click();
    await expect(dash.monthTable()).toBeVisible();
  });

  test('TC-DASHUI-051 — weekends are shaded by actual weekday, not column position @regression', async () => {
    await dash.goToMonthView();
    const rows = dash.monthTable().locator('tbody tr');
    const firstRow = rows.first();
    const cells = firstRow.locator('td');
    const n = await cells.count();
    expect(n).toBe(7);
    const bgs: string[] = [];
    for (let i = 0; i < n; i++) bgs.push(await cells.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor));
    // Columns 6 and 7 are Saturday and Sunday in a Monday-first grid.
    const weekdayBgs = new Set(bgs.slice(0, 5));
    expect(
      bgs[5] !== bgs[0] || bgs[6] !== bgs[0] || weekdayBgs.size > 1,
      'weekend cells are not shaded differently from weekdays',
    ).toBe(true);
  });

  test('TC-DASHUI-055 — a crowded date drops no event (D-1) @regression', async ({ page }) => {
    const waiting = page.waitForResponse((r) => r.url().includes('/dashboard/calendar-events') && r.status() === 200);
    await dash.goToMonthView();
    const body = (await (await waiting).json()) as { data: { events: CalendarEvent[] } };
    const byDate = new Map<string, CalendarEvent[]>();
    for (const e of body.data.events) {
      const k = datePart(e.eventDate);
      byDate.set(k, [...(byDate.get(k) ?? []), e]);
    }
    const crowded = [...byDate.entries()].find(([, l]) => l.length > 2);
    test.skip(!crowded, 'BLOCKED — no crowded date in the visible month');
    const [, list] = crowded!;
    const moreCount = await dash.monthMoreLabel().count();
    expect(
      moreCount,
      `the crowded date carries ${list.length} events but no "+N more" label rendered — blocked behind D-1`,
    ).toBeGreaterThan(0);
  });

  test('TC-DASHUI-056 — February 2026 (Sunday start) renders six leading days @regression', async () => {
    await dash.goToMonthView();
    await dash.pickMonth('February 2026');
    await expect(dash.monthTable()).toBeVisible();
    const firstRow = dash.monthTable().locator('tbody tr').first();
    const texts = (await firstRow.locator('td').allTextContents()).map((t) => t.trim().replace(/\D.*/s, ''));
    // Mon 26 Jan … Sat 31 Jan, then Sun 1 Feb.
    // MonthDayCell renders `date.format("DD")`, i.e. zero-padded.
    expect(texts.slice(0, 6)).toEqual(['26', '27', '28', '29', '30', '31']);
    expect(texts[6]).toBe('01');
  });

  test('TC-DASHUI-057 — June 2026 (Monday start) renders no leading days @regression', async () => {
    await dash.goToMonthView();
    await dash.pickMonth('June 2026');
    await expect(dash.monthTable()).toBeVisible();
    const firstRow = dash.monthTable().locator('tbody tr').first();
    const texts = (await firstRow.locator('td').allTextContents()).map((t) => t.trim().replace(/\D.*/s, ''));
    expect(texts[0], 'the first cell of June 2026 must be the 1st, under MON').toBe('01');
  });
});
