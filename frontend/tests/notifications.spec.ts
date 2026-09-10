/**
 * CEIQ-FEAT-012 — Notification Centre (web UI).
 * Source: testcases/TC-CEIQ-FEAT-012.md — TC-NOTUI-001…052 (52 cases, one test each).
 *
 * ── Environment reality (read before attributing any result) ──────────────────
 * Target is **dev**: app `https://dev.clearedgeiq.com`, API
 * `https://api-dev.clearedgeiq.com/api/v1` (both supplied through APP_BASE_URL /
 * APP_API_BASE_URL — never inlined here). The Notification Centre UI shipped on
 * `clearedge-frontend@origin/dev` `5201250` (2026-09-04); confirm the deployed
 * build SHA before a result is attributed to a branch (the 2026-09-02 sweep lesson).
 *
 * The feature is **NOT on QA**: the API's notifications router answers
 * `404 Cannot GET /api/v1/notifications` there, and the `qa` frontend branch
 * (`42e0dc2`) still renders the old "Upcoming Renewals" placeholder bell. The
 * top-level guard below probes the endpoint once per worker and fails every test
 * with one honest message instead of 52 unrelated selector timeouts.
 *
 * Dev fixture, and therefore the blockers named in the skip titles:
 *   • exactly five notifications, all kind 7/8, all dated today, all
 *     `isRecordAvailable: true` → no kind 1–6 row exists, only the `Today` label
 *     form has a live example, and the panel can never exceed 20 rows;
 *   • 0 contracts and 0 sourcing events → the contract/event navigation
 *     destinations have no target, and nothing can be seeded;
 *   • endpoint #5 (SSE stream) is not deployed → no mid-session arrival.
 *
 * Dismiss and clear-all are irreversible (BR-07) and consume those five rows, so
 * they live in one `describe.serial` declared LAST and are gated on
 * NOTIFICATIONS_ALLOW_DESTRUCTIVE=1.
 *
 * Layering rule this file obeys: the API suite owns whether a derived value is
 * CORRECT; a UI case never re-derives one. Every case captures the
 * `GET /v1/notifications` payload and asserts the DOM against THAT — same order,
 * same count, badge = its `unreadCount`, row text = its `message`, pill = its
 * `relativeLabel`.
 *
 * Runs under the `po` project (Procurement Owner storageState from auth.setup).
 */
import { test, expect, type APIRequestContext, type Page, type Request } from '@playwright/test';
import * as fs from 'node:fs';
import { AppLoginPage } from '../pages/AppLoginPage';
import { NotificationCentre, pathOf, type NotificationDto, type NotificationListDto } from '../pages/NotificationCentre';
import {
  CLOSED_LABEL_SET,
  DateFormat,
  DeadlineMessageTemplate,
  EM_DASH,
  ForbiddenLabelPhrasing,
  ForbiddenMessagePhrasing,
  KIND_GLYPH_CLASS,
  KIND_ICON_COLOUR,
  NotificationSelectors,
  NotificationsApiPaths,
  NotificationsAsBuilt,
  NotificationsCopy,
  PanelGeometry,
  ProposalMessageTemplate,
  RelativeLabel,
  isPermittedRelativeLabel,
} from './fixtures/expectedCopyNotifications';
import { allowsDestructiveNotifications, appApiBaseUrl, appBaseUrl, hasVar } from '../utils/env';

// The row dates are CT calendar days. On an unpinned runner a genuine off-by-one
// would appear or vanish depending on the machine's offset; pinning makes every
// date assertion in this file mean what it says.
test.use({ timezoneId: 'America/Chicago' });

/** Written by auth.setup's Procurement Manager step (kept in sync with PM_STORAGE there). */
const PM_STATE = 'playwright/.auth/pm.json';

/** True when a second, real Manager session is available for the BR-07 two-user cases. */
function hasManagerSession(): boolean {
  return hasVar('PM_EMAIL') && hasVar('PM_PASSWORD') && fs.existsSync(PM_STATE);
}

// ── deployment guard ─────────────────────────────────────────────────────────
// One unauthenticated probe of the exact list path, cached per worker. A deployed
// router answers 401 (the guard rejects the missing token); an undeployed one
// answers `404 Cannot GET …`. Anything else (including a transport failure) is
// treated as "deployed" so real defects still surface as real failures.
let deployment: { deployed: boolean; detail: string } | null = null;

async function assertFeatureDeployed(request: APIRequestContext): Promise<void> {
  if (!deployment) {
    const url = `${appApiBaseUrl().replace(/\/$/, '')}${NotificationsApiPaths.list}`;
    try {
      const res = await request.get(url, { failOnStatusCode: false });
      const body = (await res.text()).slice(0, 200);
      const missing = res.status() === 404 && /cannot\s+(get|post)/i.test(body);
      deployment = { deployed: !missing, detail: `HTTP ${res.status()} ${body}` };
    } catch (error) {
      deployment = { deployed: true, detail: `probe transport failure: ${String(error)}` };
    }
  }
  if (!deployment.deployed) {
    throw new Error(
      `CEIQ-FEAT-012 is not deployed on this environment (${appBaseUrl()}). Nothing to assert. ` +
        `Probe of ${NotificationsApiPaths.list} returned: ${deployment.detail}`,
    );
  }
}

test.beforeEach(async ({ request }) => {
  await assertFeatureDeployed(request);
});

// ── local helpers ────────────────────────────────────────────────────────────

interface SeenRequest {
  method: string;
  path: string;
}

/** Record every notification-family request from now on (SSE stream included, so it can be excluded). */
function watchNotificationRequests(page: Page): { seen: SeenRequest[]; stop: () => void } {
  const seen: SeenRequest[] = [];
  const listener = (request: Request): void => {
    const path = pathOf(request.url());
    if (path.includes(NotificationsApiPaths.list)) seen.push({ method: request.method(), path });
  };
  page.on('request', listener);
  return {
    seen,
    stop: (): void => {
      page.off('request', listener);
    },
  };
}

const isListCall = (r: SeenRequest, method: string): boolean =>
  r.method === method && r.path.endsWith(NotificationsApiPaths.list);
const isReadCall = (r: SeenRequest): boolean => r.method === 'PATCH' && r.path.endsWith(NotificationsApiPaths.readSuffix);
const isDismissCall = (r: SeenRequest): boolean =>
  r.method === 'DELETE' && !r.path.endsWith(NotificationsApiPaths.list);

/**
 * The CT calendar day an `eventDate` denotes, as `MM/DD/YYYY`.
 *
 * Deviation D-1: the API returns `eventDate` as `2026-09-04T00:00:00.000Z` rather
 * than the documented `2026-09-04`. A date-only value pinned to UTC midnight denotes
 * that calendar day — converting it to CT would slide it back a day — so the UTC
 * date part is taken verbatim for those, and only a real timestamp is converted to
 * America/Chicago. A naive `slice(0,10)` on a genuine timestamp would be the mirror
 * error, which is why both branches exist.
 */
function ctCalendarDay(eventDate: string): string {
  // A DATE-ONLY value ("2026-09-10") and a UTC-midnight timestamp both denote a calendar
  // day, not an instant. `new Date("2026-09-10")` parses as UTC midnight, so converting it
  // to America/Chicago would shift it back one day and make a correct render look wrong.
  const isCalendarDay = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) || /T00:00:00(\.000)?Z$/.test(eventDate);
  if (isCalendarDay) {
    const [year, month, day] = eventDate.slice(0, 10).split('-');
    return `${month}/${day}/${year}`;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(eventDate));
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('month')}/${pick('day')}/${pick('year')}`;
}

const firstUnread = (list: NotificationListDto): NotificationDto | undefined =>
  list.notifications.find((n) => !n.isRead);
const firstRead = (list: NotificationListDto): NotificationDto | undefined => list.notifications.find((n) => n.isRead);

// =============================================================================
// Module: bell, badge, panel open/close and row anatomy (AC-001…AC-003)
// Read-only. Declared first so it runs before anything consumes the fixture.
// =============================================================================
test.describe('Notification Centre — bell, badge and panel (AC-001, AC-002)', () => {
  test('TC-NOTUI-001 — the bell renders in the header on every authenticated page @smoke @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      // The SSE endpoint is not deployed on dev, so the client's EventSource retry
      // loop logs network noise on every page. That is a known, separately-tracked
      // gap (endpoint #5), not a header defect — excluded so this case stays about
      // the header.
      if (msg.type() !== 'error') return;
      if (/notifications\/stream|EventSource|Failed to load resource/i.test(msg.text())) return;
      consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const route of ['/dashboard', '/contracts', '/sourcing', '/vendors', '/user-management']) {
      await nc.goto(route);
      await expect(nc.bell(), `bell missing on ${route}`).toHaveCount(1);
      await expect(nc.bell(), `bell not visible on ${route}`).toBeVisible();
      await expect(nc.bell(), `bell disabled on ${route}`).toBeEnabled();
    }
    expect(pageErrors, 'the header raised an uncaught exception during navigation').toEqual([]);
    expect(consoleErrors, 'the header logged a console error during navigation').toEqual([]);
  });

  test('TC-NOTUI-002 — the badge displays the unreadCount GET /notifications returned @smoke @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.unreadCount === 0, 'BLOCKED — no unread notification on this run (badge-hidden path is TC-NOTUI-003)');
    // The UI paints the API's number; the test never recounts rows.
    expect(await nc.badgeText()).toBe(String(list.unreadCount));
    await expect(nc.badge().first()).toBeVisible();
  });

  test('TC-NOTUI-007 — a page load fetches the panel state once and paints the badge from it @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const watcher = watchNotificationRequests(page);
    const list = await nc.gotoCapturing();
    watcher.stop();

    // Exact path only — the failing EventSource retries against `/stream` are also
    // in the capture on dev and must not be counted as endpoint #1 calls.
    const listGets = watcher.seen.filter((r) => isListCall(r, 'GET'));
    expect(listGets, 'endpoint #1 should be called exactly once per page load').toHaveLength(1);
    expect(list).toHaveProperty('notifications');
    expect(list).toHaveProperty('unreadCount');
    expect(list).toHaveProperty('totalUndismissed');
    expect(watcher.seen.filter(isReadCall), 'a page load must mark nothing read').toEqual([]);
    expect(watcher.seen.filter((r) => r.method === 'DELETE'), 'a page load must dismiss nothing').toEqual([]);

    if (list.unreadCount > 0) expect(await nc.badgeText()).toBe(String(list.unreadCount));
    else expect(await nc.isBadgeVisible()).toBe(false);
  });

  test('TC-NOTUI-008 — the bell is not rendered on the unauthenticated login page @regression', async ({ browser }) => {
    // A fresh context with no storageState — the `po` session must not leak in.
    const context = await browser.newContext();
    const page = await context.newPage();
    const watcher = watchNotificationRequests(page);
    await new AppLoginPage(page).goto();

    await expect(page.locator(NotificationSelectors.bell)).toHaveCount(0);
    await expect(page.locator(NotificationSelectors.row)).toHaveCount(0);
    expect(watcher.seen.filter((r) => isListCall(r, 'GET')), 'no notification fetch may fire while unauthenticated').toEqual(
      [],
    );
    watcher.stop();
    await context.close();
  });

  test('TC-NOTUI-009 — clicking the bell opens the notification panel @smoke @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    // trigger="click": nothing may be open before the click (hover must not open it).
    await expect(nc.panelHeaderText()).toHaveCount(0);

    const watcher = watchNotificationRequests(page);
    await nc.open();
    await expect(nc.panel()).toBeVisible();

    if (list.notifications.length === 0) {
      await expect(nc.emptyState()).toBeVisible();
    } else {
      await expect(nc.rows()).toHaveCount(list.notifications.length);
    }

    const panelBox = await nc.panelBody().boundingBox();
    const bellBox = await nc.bell().boundingBox();
    expect(panelBox && bellBox).toBeTruthy();
    // boundingBox() is fractional (399.x observed), so compare with a 1 px tolerance
    // rather than an exact integer match.
    expect(
      Math.abs(panelBox!.width - PanelGeometry.widthPx),
      `panel content width (Tech §6.2) was ${panelBox!.width}, expected ${PanelGeometry.widthPx}`,
    ).toBeLessThanOrEqual(1);
    // placement="bottomRight": below the bell and right-aligned to it (AntD adds a
    // small arrow/offset, hence the tolerance rather than an exact edge match).
    expect(panelBox!.y, 'panel should hang below the bell').toBeGreaterThan(bellBox!.y);
    expect(
      Math.abs(panelBox!.x + panelBox!.width - (bellBox!.x + bellBox!.width)),
      'panel should be right-aligned to the bell',
    ).toBeLessThan(80);

    // BR-06 — opening the panel creates or changes nothing.
    expect(watcher.seen.filter(isReadCall)).toEqual([]);
    expect(watcher.seen.filter((r) => r.method === 'DELETE')).toEqual([]);
    watcher.stop();
  });

  test('TC-NOTUI-010 — the open panel shows a "Notifications" header and a "Clear all" action @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    await nc.open();

    await expect(nc.panelHeaderText()).toBeVisible();
    await expect(nc.clearAllButton()).toBeVisible();
    if (list.totalUndismissed > 0) {
      await expect(nc.clearAllButton(), 'Clear all must be enabled while something can be cleared').toBeEnabled();
    }

    // Both sit ABOVE the scrollable row list in the panel (DOM order, observed as geometry).
    if (list.notifications.length > 0) {
      const headerBox = await nc.panelHeaderText().boundingBox();
      const clearBox = await nc.clearAllButton().boundingBox();
      const listBox = await nc.scrollContainer().boundingBox();
      expect(headerBox && clearBox && listBox).toBeTruthy();
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(listBox!.y + 1);
      expect(clearBox!.y + clearBox!.height).toBeLessThanOrEqual(listBox!.y + 1);
    }
    // Presence and enabled-state only — clicking it belongs to TC-NOTUI-038.
    await nc.closeWithEscape();
  });

  test('TC-NOTUI-011 — the panel renders rows in the order the API returned them @smoke @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    await expect(nc.rows()).toHaveCount(list.notifications.length);
    // Fidelity to the API's sequence only. The correctness of the BR-01 ordering
    // itself is an API-layer concern and is deliberately NOT re-derived here.
    expect(await nc.renderedMessages()).toEqual(list.notifications.map((n) => n.message));
  });

  test('TC-NOTUI-013 — clicking outside the panel closes it with no other effect @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    await nc.gotoCapturing();
    const badgeBefore = await nc.badgeText();
    const urlBefore = page.url();
    await nc.open();

    const watcher = watchNotificationRequests(page);
    await nc.close(); // picks an inert outside target at runtime

    await expect(nc.panelHeaderText()).toHaveCount(0);
    expect(await nc.badgeText()).toBe(badgeBefore);
    expect(page.url(), 'the outside click must navigate nowhere').toBe(urlBefore);
    expect(watcher.seen.filter(isReadCall)).toEqual([]);
    expect(watcher.seen.filter((r) => r.method === 'DELETE')).toEqual([]);
    watcher.stop();
  });

  test('TC-NOTUI-014 — pressing Escape closes the panel with no other effect @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    await nc.gotoCapturing();
    const badgeBefore = await nc.badgeText();
    const urlBefore = page.url();
    await nc.open();

    const watcher = watchNotificationRequests(page);
    await nc.closeWithEscape();

    expect(await nc.badgeText()).toBe(badgeBefore);
    expect(page.url()).toBe(urlBefore);
    expect(watcher.seen.filter(isReadCall)).toEqual([]);
    expect(watcher.seen.filter((r) => r.method === 'DELETE')).toEqual([]);
    watcher.stop();

    // The bell still re-opens the panel afterwards.
    await nc.open();
    await expect(nc.panelHeaderText()).toBeVisible();
    await nc.closeWithEscape();
  });

  test('TC-NOTUI-015 — closing the panel marks nothing read and dismisses nothing @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const before = await nc.gotoCapturing();
    test.skip(before.notifications.length === 0, 'BLOCKED — the panel is empty on this run');

    await nc.open();
    const dotsBefore = await nc.unreadDots().count();
    await nc.close();
    await nc.open();
    await nc.closeWithEscape();

    const after = await nc.reloadCapturing();
    expect(after.unreadCount).toBe(before.unreadCount);
    expect(after.totalUndismissed).toBe(before.totalUndismissed);
    expect(
      after.notifications.map((n) => [n.id, n.isRead]),
      'no notification may flip to read merely by opening and closing the panel',
    ).toEqual(before.notifications.map((n) => [n.id, n.isRead]));

    await nc.open();
    expect(await nc.unreadDots().count()).toBe(dotsBefore);
    await nc.closeWithEscape();
  });

  test('TC-NOTUI-017 — every notification row renders a type icon @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    await expect(nc.typeIcons()).toHaveCount(list.notifications.length);
    for (let i = 0; i < list.notifications.length; i++) {
      await expect(nc.rowTypeIcon(i), `row ${i} must carry exactly one type icon`).toHaveCount(1);
      await expect(nc.rowTypeIcon(i)).toBeVisible();
    }
    // Presence only — glyph identity and colour belong to TC-NOTUI-051.
  });

  test('TC-NOTUI-018 — a row renders the message text exactly as the API returned it @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      const rendered = await nc.rowMessageText(i);
      expect(rendered, `row ${i} message must equal the API string character for character`).toBe(notification.message);
      expect(rendered, `row ${i} message must not be ellipsised`).not.toMatch(/…|\.\.\.$/);
      expect(rendered, `row ${i} message must carry no "(N-day reminder)" the API did not send`).not.toMatch(
        ForbiddenMessagePhrasing.reminderQualifier,
      );
    }
  });

  test('TC-NOTUI-019 — a row renders the relative-time label exactly as the API returned it @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const available = list.notifications.filter((n) => n.isRecordAvailable);
    test.skip(available.length === 0, 'BLOCKED — no isRecordAvailable row on this run (the pill renders only for those)');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      if (!notification.isRecordAvailable) continue;
      expect(await nc.rowLabelPillCount(i), `row ${i} must render exactly one label pill`).toBe(1);
      // The client must not recompute the label from eventDate, nor localise it.
      expect(await nc.rowLabelText(i)).toBe(notification.relativeLabel);
    }
  });

  test('TC-NOTUI-020 — an unread row carries the unread dot marker @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const unread = list.notifications.filter((n) => !n.isRead);
    test.skip(unread.length === 0, 'BLOCKED — no unread notification remains on this run');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      if (!notification.isRead) {
        await expect(nc.rowUnreadDot(i), `unread row ${i} must carry exactly one dot`).toHaveCount(1);
        await expect(nc.rowUnreadDot(i)).toBeVisible();
      }
    }
    await expect(nc.unreadDots()).toHaveCount(unread.length);
  });

  test('TC-NOTUI-024 — every notification row exposes a dismiss (×) control @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');

    const watcher = watchNotificationRequests(page);
    await nc.open();
    await expect(nc.dismissControls()).toHaveCount(list.notifications.length);
    for (let i = 0; i < list.notifications.length; i++) {
      await expect(nc.rowDismiss(i), `row ${i} must carry exactly one dismiss control`).toHaveCount(1);
      await expect(nc.rowDismiss(i)).toBeVisible();
      await expect(nc.rowDismiss(i)).toBeEnabled();
      await nc.rowDismiss(i).hover(); // hovering must not dismiss
    }
    expect(watcher.seen.filter(isDismissCall), 'rendering or hovering the panel must dismiss nothing').toEqual([]);
    watcher.stop();
    await nc.closeWithEscape();
  });

  // ── blocked in this environment ─────────────────────────────────────────────

  test.skip('TC-NOTUI-005 — the badge increments when a proposal notification arrives mid-session [BLOCKED: CLRE-387 — endpoint #5 GET /notifications/stream still 404s on QA (re-probed 2026-09-10), so nothing can arrive mid-session] @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const before = await nc.gotoCapturing();
    // Unblocking: deploy endpoint #5 and trigger a vendor proposal submit for the
    // dev tenant, then assert the badge moves with no reload.
    await expect
      .poll(async () => Number(await nc.badgeText()), { timeout: 60_000 })
      .toBe(before.unreadCount + 1);
  });

  test('TC-NOTUI-006 — a two-or-more-digit unread count renders as one legible number @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10: the tenant carries 13 unread notifications, so the
    // two-digit badge is reachable without a seeding endpoint. Gated rather than
    // asserted so a tenant that happens to sit below 10 reports BLOCKED, not a failure.
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.unreadCount < 10, 'BLOCKED — fewer than 10 unread notifications on this run');
    expect(await nc.badgeText()).toBe(String(list.unreadCount));
    // One custom <span>, not AntD's per-digit ScrollNumber split.
    await expect(nc.badgeCountElement()).toHaveCount(1);
    const digitNodes = await nc.badgeCountElement().locator('.ant-scroll-number-only').count();
    expect(digitNodes, 'the count must not be split into one element per digit').toBe(0);
  });

  test('TC-NOTUI-012 — the panel shows at most 20 rows inside a scrollable container @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10: 512 undismissed notifications, of which the endpoint
    // returns exactly 20 — the cap this case exists to prove.
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(
      list.totalUndismissed <= PanelGeometry.visibleWindow,
      'BLOCKED — the tenant holds at most 20 undismissed notifications, so the cap cannot be observed',
    );
    expect(list.notifications.length).toBe(PanelGeometry.visibleWindow);
    expect(list.totalUndismissed).toBeGreaterThan(PanelGeometry.visibleWindow);
    await nc.open();
    // The 21st is ABSENT from the DOM, not merely hidden.
    await expect(nc.rows()).toHaveCount(PanelGeometry.visibleWindow);
    const style = await nc
      .scrollContainer()
      .evaluate((el) => ({ maxHeight: getComputedStyle(el).maxHeight, overflowY: getComputedStyle(el).overflowY }));
    expect(style.maxHeight).toBe(`${PanelGeometry.listMaxHeightPx}px`);
    expect(style.overflowY).toBe('auto');
  });

  test.skip('TC-NOTUI-016 — a proposal notification arriving while the panel is open inserts in place [BLOCKED: CLRE-387 — endpoint #5 GET /notifications/stream still 404s on QA (re-probed 2026-09-10), so no row can arrive while the panel is open] @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    await nc.gotoCapturing();
    await nc.open();
    const scrollTopBefore = await nc.scrollContainer().evaluate((el) => el.scrollTop);
    const rowsBefore = await nc.rows().count();
    // Unblocking: trigger a vendor proposal action here.
    await expect(nc.rows()).toHaveCount(rowsBefore + 1);
    await expect(nc.panelHeaderText()).toBeVisible();
    expect(await nc.scrollContainer().evaluate((el) => el.scrollTop)).toBe(scrollTopBefore);
  });
});

// =============================================================================
// Module: the copy contract — labels, dates, message templates, icon mapping
// (validation rules, BR-02, BR-03). Read-only; runs before anything is consumed.
// =============================================================================
test.describe('Notification Centre — copy contract (validation rules, BR-02, BR-03)', () => {
  test('TC-NOTUI-043 — each row carries exactly one relative-time label from the closed set @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const available = list.notifications.filter((n) => n.isRecordAvailable);
    test.skip(available.length === 0, 'BLOCKED — no isRecordAvailable row on this run (the pill renders only for those)');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      if (!notification.isRecordAvailable) continue;
      expect(await nc.rowLabelPillCount(i), `row ${i}: exactly one pill, not zero and not two`).toBe(1);
      const label = await nc.rowLabelText(i);
      expect(label, `row ${i}: the UI must paint the server's label verbatim`).toBe(notification.relativeLabel);
      expect(
        isPermittedRelativeLabel(label),
        `row ${i}: "${label}" is outside the closed set ${CLOSED_LABEL_SET.map(String).join(' | ')}`,
      ).toBe(true);
      // No second time-flavoured text beside the pill.
      const rest = (await nc.rowText(i)).replace(notification.message, '').replace(label, '').trim();
      expect(rest, `row ${i}: extra time wording rendered beside the pill`).not.toMatch(/just now|\(new\)|\d{1,2}:\d{2}/i);
    }
    // Dev exercises only the `Today` form; the other four are TC-NOTUI-048 (blocked).
  });

  test('TC-NOTUI-044 — forbidden label phrasings never appear in a notification row @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      const text = await nc.rowText(i);
      expect(text, `row ${i}: "Nd left" shorthand`).not.toMatch(ForbiddenLabelPhrasing.dayShorthandLeft);
      expect(text, `row ${i}: "N days remaining"`).not.toMatch(ForbiddenLabelPhrasing.daysRemaining);

      if (!notification.isRecordAvailable) continue;
      const label = await nc.rowLabelText(i);
      // The "passed" prohibition is scoped to the LABEL — it is legitimate inside a
      // kind-6 message (`Notice deadline passed on MM/DD/YYYY CT`).
      expect(label, `row ${i}: label may not begin with "passed"`).not.toMatch(ForbiddenLabelPhrasing.passedPrefix);
      const strayInLabel = label.match(ForbiddenLabelPhrasing.strayUrgencyWord);
      if (strayInLabel) {
        // `ago` is permitted, but only as the exact `N days ago` form.
        expect(RelativeLabel.nDaysAgo.test(label), `row ${i}: stray urgency word in label "${label}"`).toBe(true);
      }
      expect(isPermittedRelativeLabel(label), `row ${i}: label "${label}" is outside the closed set`).toBe(true);
    }
  });

  test('TC-NOTUI-045 — every date in a row reads MM/DD/YYYY with a trailing CT and is never bare @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      const text = await nc.rowText(i);
      expect(text, `row ${i}: ISO date leaked into the row`).not.toMatch(DateFormat.isoDate);
      expect(text, `row ${i}: long-form date leaked into the row`).not.toMatch(DateFormat.longDate);
      expect(text, `row ${i}: CT replaced by a UTC offset`).not.toMatch(DateFormat.utcOffset);

      const occurrences = text.match(DateFormat.anyUsDate) ?? [];
      for (const occurrence of occurrences) {
        expect(occurrence, `row ${i}: "${occurrence}" is not zero-padded MM/DD/YYYY`).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
        expect(text, `row ${i}: "${occurrence}" is not followed by " CT"`).toContain(`${occurrence} CT`);
      }
      if (occurrences.length > 0) {
        // D-1 aware: compare against the CT calendar day the API's eventDate denotes.
        expect(occurrences, `row ${i}: rendered date does not match the eventDate's CT calendar day`).toContain(
          ctCalendarDay(notification.eventDate),
        );
      }
    }
  });

  test('TC-NOTUI-046 — message text carries no day count and no "(N-day reminder)" qualifier @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    for (let i = 0; i < list.notifications.length; i++) {
      const message = await nc.rowMessageText(i);
      expect(message, `row ${i}: reminder qualifier`).not.toMatch(ForbiddenMessagePhrasing.reminderQualifier);
      expect(message, `row ${i}: day count`).not.toMatch(ForbiddenMessagePhrasing.dayCount);
      expect(message, `row ${i}: "in N"`).not.toMatch(ForbiddenMessagePhrasing.inNumber);
      expect(message, `row ${i}: "Nd" shorthand`).not.toMatch(ForbiddenMessagePhrasing.dayShorthand);
      expect(message, `row ${i}: "T-N" shorthand`).not.toMatch(ForbiddenMessagePhrasing.tMinus);
      expect(message, `row ${i}: label wording duplicated into the message`).not.toMatch(
        ForbiddenMessagePhrasing.relativeWord,
      );
      // A blanket "no numerals outside the date" sweep used to sit here. It cannot
      // hold: the entity name is user data and legitimately carries digits — real
      // titles like "Q3 2026 RFP" and QA's own "VP seed rfq 1786455375786" — and the
      // name is not always a strippable prefix (kinds 7/8 embed it mid-sentence:
      // "<Vendor> withdrew their proposal for <event> on MM/DD/YYYY CT"). The claim
      // this case actually makes is the five phrasings above, each of which already
      // matches a day count wherever it appears, so nothing is lost by dropping it.
    }
    // On dev only kinds 7/8 exist; kinds 1, 2 and 5 are the ones most at risk of a
    // "(N-day reminder)" leak and cannot be observed today (see TC-NOTUI-050).
  });

  test('TC-NOTUI-047 — the absolute date precedes the relative-time label in the row @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const available = list.notifications.filter((n) => n.isRecordAvailable);
    test.skip(available.length === 0, 'BLOCKED — no isRecordAvailable row on this run (the pill renders only for those)');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      if (!notification.isRecordAvailable) continue;
      const message = await nc.rowMessageText(i);
      const label = await nc.rowLabelText(i);
      const dateMatch = message.match(DateFormat.usDateWithCt);
      if (!dateMatch) continue; // a message with no date has nothing to order

      // 1/3 — document order and concatenated-text order.
      const rowText = await nc.rowText(i);
      expect(rowText.indexOf(dateMatch[0]), `row ${i}: the date must precede the label in the row text`).toBeLessThan(
        rowText.lastIndexOf(label),
      );
      // 2 — the pill sits UNDER the message line.
      const messageBox = await nc.rowMessage(i).boundingBox();
      const pillBox = await nc.rowLabelPill(i).boundingBox();
      expect(messageBox && pillBox).toBeTruthy();
      expect(pillBox!.y, `row ${i}: the label pill must sit at or below the message line`).toBeGreaterThanOrEqual(
        messageBox!.y + messageBox!.height - 2,
      );
      // 4 — date and label are not interleaved into one phrase.
      expect(message, `row ${i}: the label leaked into the message line`).not.toContain(label);
    }
  });

  test('TC-NOTUI-049 — proposal message text (kinds 7 and 8) matches the BR-03 template exactly @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const proposals = list.notifications.filter((n) => n.kind === 7 || n.kind === 8);
    test.skip(proposals.length === 0, 'BLOCKED — no kind 7/8 notification on this run');
    await nc.open();

    for (const [i, notification] of list.notifications.entries()) {
      if (notification.kind !== 7 && notification.kind !== 8) continue;
      const rendered = await nc.rowMessageText(i);
      expect(rendered, `row ${i}: rendered message must equal the API's pre-rendered string`).toBe(notification.message);
      const template = notification.kind === 7 ? ProposalMessageTemplate.submitted : ProposalMessageTemplate.withdrawn;
      expect(rendered, `row ${i}: kind ${notification.kind} BR-03 template`).toMatch(template);
      expect(rendered, `row ${i}: kind 8 must read "withdrew their proposal"`).not.toMatch(
        /withdrew (a|the) proposal/,
      );
      expect(rendered, `row ${i}: no trailing punctuation`).not.toMatch(/[.!;]$/);
      // The `[Vendor] — [title]` composition belongs to contract display names only.
      expect(rendered, `row ${i}: em dash in a proposal message`).not.toContain(EM_DASH);
      expect(rendered, `row ${i}: a UUID leaked into the message`).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    }
  });

  test('TC-NOTUI-051 — the type icon distinguishes the kind by colour and glyph @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    await nc.open();

    // PARTIAL: expectations 1 and 5 (the amber half and the full eight-way
    // distinction) need kinds 1–6, which do not exist on dev. What runs here is the
    // mapping over the kinds actually present — no hex is pinned, so a theme change
    // cannot make this pass or fail spuriously.
    const colourByBucket = new Map<string, string>();
    for (const [i, notification] of list.notifications.entries()) {
      expect(
        notification.iconColor,
        `row ${i}: the API's kind ${notification.kind} → iconColor must follow BR-03`,
      ).toBe(KIND_ICON_COLOUR[notification.kind]);

      const rendered = await nc.rowIconColour(i);
      const known = colourByBucket.get(notification.iconColor);
      if (known === undefined) colourByBucket.set(notification.iconColor, rendered);
      else expect(rendered, `row ${i}: rows sharing iconColor "${notification.iconColor}" must render one colour`).toBe(known);

      const classes = await nc.rowGlyphClasses(i);
      expect(classes, `row ${i}: kind ${notification.kind} glyph`).toContain(KIND_GLYPH_CLASS[notification.kind]);
    }
    // Different iconColor buckets must be visually different from one another.
    const distinct = new Set(colourByBucket.values());
    expect(distinct.size, 'two different iconColor buckets rendered the same colour').toBe(colourByBucket.size);

    const kindsPresent = new Set(list.notifications.map((n) => n.kind));
    if (![1, 2, 3, 4, 5, 6].some((k) => kindsPresent.has(k))) {
      test.info().annotations.push({
        type: 'partial',
        description:
          'Expected results 1 and 5 not covered: no kind 1–6 notification exists on dev, so the amber ' +
          'mapping and the full eight-way glyph distinction are unobservable.',
      });
    }
  });

  // ── blocked in this environment ─────────────────────────────────────────────

  test('TC-NOTUI-048 — direction is carried by the label wording alone, at equal day distance @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    // Needs at least one row at a non-zero day distance; QA is currently all `Today`.
    // Runtime-gated instead of hard-skipped so it runs on any tenant that has one.
    test.skip(
      list.notifications.every((n) => n.relativeLabel === 'Today'),
      'BLOCKED — every row is dated today, so no direction wording exists to compare',
    );
    await nc.open();
    for (const [i, notification] of list.notifications.entries()) {
      // The unavailable-record text REPLACES the pill, so such a row has no label.
      if (!notification.isRecordAvailable) continue;
      const label = await nc.rowLabelText(i);
      expect(label).toBe(notification.relativeLabel);
      expect(label).not.toMatch(/^In 1 days$|^1 days ago$|^In 0 days$/);
      expect(isPermittedRelativeLabel(label)).toBe(true);
      // Direction lives in the wording only — no arrow, sign or icon carries it.
      expect(label).not.toMatch(/[→←↑↓+±]/);
    }
  });

  test('TC-NOTUI-050 — deadline message text (kinds 1–6) matches BR-03 and the display-name rule @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10: the tenant carries kind-2 (event submission deadline)
    // rows, so the BR-03 template can be checked against real copy.
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(!list.notifications.some((n) => n.kind <= 6), 'BLOCKED — no kind 1–6 notification on this run');
    await nc.open();
    for (const [i, notification] of list.notifications.entries()) {
      if (notification.kind > 6) continue;
      const rendered = await nc.rowMessageText(i);
      expect(rendered).toBe(notification.message);
      expect(rendered, `row ${i}: kind ${notification.kind} BR-03 template`).toMatch(
        DeadlineMessageTemplate[notification.kind]!,
      );
      if (notification.referenceType === 'contract') {
        const displayName = rendered.split(': ')[0] ?? '';
        // `<Vendor> — <title>` with ONE em dash, or `<title>` alone. Never two.
        expect(displayName.split(EM_DASH).length, `row ${i}: at most one em dash in the display name`).toBeLessThanOrEqual(
          2,
        );
        if (displayName.includes(EM_DASH)) expect(displayName, `row ${i}: single space either side of the em dash`).toMatch(
          new RegExp(`^.+ ${EM_DASH} .+$`),
        );
      }
    }
  });

  test('TC-NOTUI-052 — the panel list scrolls rather than clipping at its maximum of 20 rows @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10 — the tenant returns a full 20-row window.
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(
      list.notifications.length < PanelGeometry.visibleWindow,
      'BLOCKED — fewer than 20 rows on this run, so the list does not overflow',
    );
    expect(list.notifications.length).toBe(PanelGeometry.visibleWindow);
    await nc.open();
    await expect(nc.rows()).toHaveCount(PanelGeometry.visibleWindow);

    const metrics = await nc.scrollContainer().evaluate((el) => ({
      maxHeight: getComputedStyle(el).maxHeight,
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(metrics.maxHeight).toBe(`${PanelGeometry.listMaxHeightPx}px`);
    expect(metrics.overflowY).toBe('auto');
    expect(metrics.scrollHeight, 'the list must actually scroll').toBeGreaterThan(metrics.clientHeight);
    expect(Math.abs((await nc.panelBody().boundingBox())!.width - PanelGeometry.widthPx)).toBeLessThanOrEqual(1);

    await nc.scrollContainer().evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(nc.rowByIndex(PanelGeometry.visibleWindow - 1)).toBeVisible();
    expect(await nc.rowMessageText(PanelGeometry.visibleWindow - 1)).toBe(
      list.notifications[PanelGeometry.visibleWindow - 1]!.message,
    );
    await expect(nc.panelHeaderText()).toBeVisible();
    await expect(nc.clearAllButton()).toBeVisible();
  });
});

// =============================================================================
// Module: row click, mark-read and navigation (AC-003 read styling, AC-004)
// These cases CONSUME the unread fixture (there is no un-read endpoint), so they
// run after every read-only case and before the dismiss family.
// =============================================================================
test.describe('Notification Centre — row click, mark read and navigation (AC-003, AC-004)', () => {
  test('TC-NOTUI-021 — an unread row is painted with the distinct unread background @regression', async ({
    page,
    request,
  }) => {
    const nc = new NotificationCentre(page);
    let list = await nc.gotoCapturing();
    test.skip(list.notifications.length < 2, 'BLOCKED — fewer than two notifications, so the two backgrounds cannot be compared');

    if (!list.notifications.some((n) => n.isRead)) {
      // Marking read through the API (not by clicking) keeps this case independent
      // of the AC-004 click-and-navigate behaviour.
      await nc.markReadViaApi(request, list.notifications[0]!.id);
      list = await nc.reloadCapturing();
    }
    const unreadIndex = list.notifications.findIndex((n) => !n.isRead);
    const readIndex = list.notifications.findIndex((n) => n.isRead);
    test.skip(unreadIndex < 0 || readIndex < 0, 'BLOCKED — the panel no longer holds both a read and an unread row');

    await nc.open();
    const unreadBg = await nc.rowBackground(unreadIndex);
    const readBg = await nc.rowBackground(readIndex);
    expect(readBg, 'a read row must have no fill').toBe('rgba(0, 0, 0, 0)');
    expect(unreadBg, 'an unread row must carry the theme fill token, not transparent').not.toBe('rgba(0, 0, 0, 0)');
    expect(unreadBg, 'unread and read rows must be distinguishable').not.toBe(readBg);
  });

  test('TC-NOTUI-022 — a read row renders no unread dot @regression', async ({ page, request }) => {
    const nc = new NotificationCentre(page);
    let list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');

    if (!list.notifications.some((n) => n.isRead)) {
      await nc.markReadViaApi(request, list.notifications[0]!.id);
      list = await nc.reloadCapturing();
    }
    const index = list.notifications.findIndex((n) => n.isRead);
    test.skip(index < 0, 'BLOCKED — no read notification on this run');

    await nc.open();
    // Not rendered at all, not merely hidden by CSS.
    await expect(nc.rowUnreadDot(index)).toHaveCount(0);
    await expect(nc.rowTypeIcon(index)).toHaveCount(1);
    expect(await nc.rowMessageText(index)).toBe(list.notifications[index]!.message);
    if (list.notifications[index]!.isRecordAvailable) {
      expect(await nc.rowLabelText(index)).toBe(list.notifications[index]!.relativeLabel);
    }
  });

  test('TC-NOTUI-023 — a read row is painted with the plain background @regression', async ({ page, request }) => {
    const nc = new NotificationCentre(page);
    let list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');

    if (!list.notifications.some((n) => n.isRead)) {
      await nc.markReadViaApi(request, list.notifications[0]!.id);
      list = await nc.reloadCapturing();
    }
    const index = list.notifications.findIndex((n) => n.isRead);
    test.skip(index < 0, 'BLOCKED — no read notification on this run');

    await nc.open();
    expect(await nc.rowBackground(index)).toBe('rgba(0, 0, 0, 0)');
    const inlineBackground = await nc.rowByIndex(index).evaluate((el) => (el as HTMLElement).style.background);
    expect(inlineBackground, 'a read row must carry no unread fill').toMatch(/^(transparent)?$/);
  });

  test('TC-NOTUI-025 — EC-01: a row click is not swallowed by close-on-outside-click @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — the panel is empty on this run');
    const target = list.notifications[0]!;

    await nc.open();
    const watcher = watchNotificationRequests(page);
    const readResponse = page.waitForResponse(
      (r) => nc.isReadPath(r.url(), target.id) && r.request().method() === 'PATCH',
    );
    await nc.clickRow(0);
    const response = await readResponse;
    expect(response.status(), 'the single click must produce the row action, not just a panel close').toBe(200);

    // Handled once — not doubled by both the row and the outside-click handler.
    expect(watcher.seen.filter((r) => isReadCall(r) && r.path.includes(target.id))).toHaveLength(1);
    expect(watcher.seen.filter((r) => r.method === 'DELETE'), 'a row click is not a dismiss').toEqual([]);
    watcher.stop();
  });

  test('TC-NOTUI-026 — clicking a row marks it read and decrements the badge @smoke @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const target = firstUnread(list);
    test.skip(!target, 'BLOCKED — no unread notification remains on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    const before = list.unreadCount;
    expect(await nc.badgeText()).toBe(String(before));

    await nc.open();
    await expect(nc.rowUnreadDot(index)).toHaveCount(1);
    const readResponse = page.waitForResponse(
      (r) => nc.isReadPath(r.url(), target!.id) && r.request().method() === 'PATCH',
    );
    await nc.clickRow(index);
    const response = await readResponse;
    expect(response.status()).toBe(200);

    // The optimistic badge value…
    if (before - 1 === 0) await expect.poll(async () => nc.isBadgeVisible()).toBe(false);
    else await expect.poll(async () => nc.badgeText()).toBe(String(before - 1));

    // …and the persisted one, so an optimistic-only regression is caught.
    const after = await nc.reloadCapturing();
    expect(after.unreadCount).toBe(before - 1);
    expect(after.notifications.find((n) => n.id === target!.id)?.isRead).toBe(true);
    await nc.open();
    const newIndex = after.notifications.findIndex((n) => n.id === target!.id);
    await expect(nc.rowUnreadDot(newIndex)).toHaveCount(0);
    expect(await nc.rowBackground(newIndex)).toBe('rgba(0, 0, 0, 0)');
  });

  test('TC-NOTUI-029 — clicking a proposal notification opens Vendors and Responses and the row stays @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const target = list.notifications.find(
      (n) => n.destinationTab === 'vendors_and_responses' && n.isRecordAvailable,
    );
    test.skip(!target, 'BLOCKED — no available kind 7/8 notification on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    const rowsBefore = list.notifications.length;

    await nc.open();
    await nc.clickRow(index);
    await expect(page).toHaveURL(new RegExp(`/sourcing/${target!.referenceId}\\?tab=vendors_and_responses`));
    // PARTIAL: expectation 2 (the detail page rendering with that tab ACTIVE) is not
    // asserted — the dev tenant holds 0 sourcing events, so the destination does not
    // resolve even though the client correctly pushes the route (deviation D-2).

    const after = await nc.gotoCapturing();
    await nc.open();
    await expect(nc.rows(), 'clicking must not remove the row').toHaveCount(rowsBefore);
    expect(await nc.indexOfMessage(target!.message)).toBeGreaterThanOrEqual(0);
    const newIndex = after.notifications.findIndex((n) => n.id === target!.id);
    await expect(nc.rowUnreadDot(newIndex)).toHaveCount(0);
    expect(await nc.rowBackground(newIndex)).toBe('rgba(0, 0, 0, 0)');
    expect(after.totalUndismissed, 'a row click must not dismiss').toBe(list.totalUndismissed);
  });

  test('TC-NOTUI-004 — the badge reflects only this user\'s read state (two users, same rows) @regression', async ({
    page,
    request,
    browser,
  }) => {
    test.skip(!hasManagerSession(), 'BLOCKED — no Procurement Manager session (set PM_EMAIL/PM_PASSWORD so auth.setup saves pm.json)');
    const po = new NotificationCentre(page);
    const poList = await po.gotoCapturing();
    const target = firstUnread(poList);
    test.skip(!target, 'BLOCKED — no unread notification remains for the Owner on this run');

    const managerContext = await browser.newContext({ storageState: PM_STATE });
    try {
      const managerPage = await managerContext.newPage();
      const manager = new NotificationCentre(managerPage);
      const managerBefore = await manager.gotoCapturing();

      // BR-07 — the feed is never filtered by role, but a notification is a PER-USER
      // row: probed on QA 2026-09-10 the Owner and Manager hold different `id`s and
      // different totals (477 vs 552) for the same tenant, because read and dismiss
      // state is each user's own. So the cross-user identity of a notification is
      // `kind` + `referenceId`, never `id`, and the two 20-row windows need not even
      // sit at the same position in the feed.
      const key = (n: NotificationDto): string => `${n.kind}:${n.referenceId}`;
      const managerByKey = new Map(managerBefore.notifications.map((n) => [key(n), n]));
      for (const row of poList.notifications) {
        const mirrored = managerByKey.get(key(row));
        if (!mirrored) continue;
        expect(mirrored.message, `${key(row)} must read identically for both users`).toBe(row.message);
        expect(mirrored.eventDate).toBe(row.eventDate);
      }

      await po.markReadViaApi(request, target!.id);
      const poAfter = await po.reloadCapturing();
      expect(poAfter.unreadCount).toBe(poList.unreadCount - 1);
      expect(await po.badgeText()).toBe(String(poAfter.unreadCount));

      const managerAfter = await manager.reloadCapturing();
      expect(managerAfter.unreadCount, "the Manager's badge must not move").toBe(managerBefore.unreadCount);
      expect(await manager.badgeText()).toBe(String(managerBefore.unreadCount));
      // Where the same underlying event IS in both windows, the Owner's read must not
      // have touched the Manager's copy of it.
      const mirroredTarget = managerAfter.notifications.findIndex((n) => key(n) === key(target!));
      if (mirroredTarget >= 0 && !managerAfter.notifications[mirroredTarget]!.isRead) {
        await manager.open();
        await expect(manager.rowUnreadDot(mirroredTarget), 'the row is still unread for the Manager').toHaveCount(1);
      }
    } finally {
      await managerContext.close();
    }
  });

  // ── blocked in this environment ─────────────────────────────────────────────

  test('TC-NOTUI-027 — clicking a contract notification opens the contract Summary tab @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const target = list.notifications.find((n) => n.referenceType === 'contract' && n.isRecordAvailable);
    // QA's 20-row window is currently all `sourcing_event`; runtime-gated so this runs
    // as soon as a contract-deadline row surfaces rather than staying hard-skipped.
    test.skip(!target, 'BLOCKED — no contract-referencing notification in the 20-row window on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    await nc.open();
    const readResponse = page.waitForResponse((r) => nc.isReadPath(r.url(), target!.id));
    await nc.clickRow(index);
    await readResponse;
    await expect(page).toHaveURL(new RegExp(`/contracts/${target!.referenceId}\\?tab=summary`));
  });

  test('TC-NOTUI-028 — clicking an event-deadline notification opens the sourcing Overview tab @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10: 892 sourcing events and a full window of kind-2 rows.
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const target = list.notifications.find((n) => n.destinationTab === 'overview' && n.isRecordAvailable);
    test.skip(!target, 'BLOCKED — no available event-deadline notification on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    await nc.open();
    const readResponse = page.waitForResponse((r) => nc.isReadPath(r.url(), target!.id));
    await nc.clickRow(index);
    await readResponse;
    await expect(page).toHaveURL(new RegExp(`/sourcing/${target!.referenceId}\\?tab=overview`));
  });

  test('TC-NOTUI-030 — clicking a row whose record is unavailable marks it read, does not navigate @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    // The server cannot produce this state today (D-2: it flags records available
    // even when their own detail endpoint 404s), so the row is manufactured by
    // rewriting the GET payload. NOTE: an intercepted case proves the UI's RENDERING
    // and click branch only — it proves nothing about the server's derivation of
    // `isRecordAvailable`, which stays uncovered until D-2 is resolved.
    await page.route(
      (url) => url.pathname.endsWith(NotificationsApiPaths.list),
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = (await response.json()) as { data: NotificationListDto };
        if (body.data.notifications[0]) body.data.notifications[0].isRecordAvailable = false;
        return route.fulfill({ response, json: body });
      },
    );

    const list = await nc.gotoCapturing();
    const target = list.notifications[0]!;
    const urlBefore = page.url();
    const badgeBefore = await nc.badgeText();
    await nc.open();

    const watcher = watchNotificationRequests(page);
    const readResponse = page.waitForResponse(
      (r) => nc.isReadPath(r.url(), target.id) && r.request().method() === 'PATCH',
    );
    await nc.clickRow(0);
    expect((await readResponse).status(), 'mark-as-read still fires for an unavailable record').toBe(200);

    expect(page.url(), 'no router.push may occur for an unavailable record').toBe(urlBefore);
    await expect(nc.panelHeaderText(), 'the panel stays open').toBeVisible();
    await expect(nc.rowUnavailable(0)).toHaveText(NotificationsCopy.unavailableRecord);
    expect(await nc.rowLabelPillCount(0), 'the label pill is replaced, not accompanied').toBe(0);
    await expect(nc.rows()).toHaveCount(list.notifications.length);
    if (!target.isRead && badgeBefore !== null) {
      await expect.poll(async () => nc.badgeText()).toBe(String(Number(badgeBefore) - 1));
    }
    watcher.stop();
  });
});

// =============================================================================
// Module: dismiss, clear-all and the empty state (AC-005, AC-006, EC-02)
//
// IRREVERSIBLE (BR-07 — a dismissed notification never returns) and the dev PO
// holds exactly five rows, so: serial, declared LAST, and gated on
// NOTIFICATIONS_ALLOW_DESTRUCTIVE=1. With five rows and five dismissing cases
// ahead of it, TC-NOTUI-040 only finds its "exactly one left" precondition when an
// earlier case skipped — it reports that as a runtime skip rather than a failure.
// =============================================================================
test.describe.serial('Notification Centre — dismiss, clear all and the empty state (AC-005, AC-006)', () => {
  /** Set by TC-NOTUI-031 and consumed by TC-NOTUI-032. */
  let dismissed: { id: string; message: string } | null = null;

  test.beforeEach(() => {
    test.skip(
      !allowsDestructiveNotifications(),
      '[BLOCKED: destructive — set NOTIFICATIONS_ALLOW_DESTRUCTIVE=1 to run]',
    );
  });

  test('TC-NOTUI-031 — dismissing a row removes it and re-renders from the DELETE response @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const before = await nc.gotoCapturing();
    test.skip(before.notifications.length === 0, 'BLOCKED — fixture exhausted: no undismissed notification remains');
    const target = before.notifications[0]!;
    const urlBefore = page.url();

    await nc.open();
    const rowsBefore = await nc.rows().count();
    const watcher = watchNotificationRequests(page);
    const refreshed = await nc.dismissRow(0);
    dismissed = { id: target.id, message: target.message };

    const deletes = watcher.seen.filter(isDismissCall);
    expect(deletes, 'exactly one DELETE, for the first row').toHaveLength(1);
    expect(deletes[0]!.path.endsWith(`/${target.id}`)).toBe(true);

    // The row count only DROPS when nothing is queued behind the 20-row window; when a
    // backlog exists the server backfills and the window stays full (BR-01, the very
    // behaviour TC-NOTUI-036 asserts). So the contract here is fidelity to the DELETE
    // response's own array, not an arithmetic decrement of what was on screen.
    const hadBacklog = before.totalUndismissed > before.notifications.length;
    await expect(nc.rows()).toHaveCount(hadBacklog ? rowsBefore : rowsBefore - 1);
    expect(await nc.indexOfMessage(target.message), 'the dismissed row must be gone').toBe(-1);
    // The panel is painted from the DELETE response — no follow-up GET is needed.
    expect(await nc.renderedMessages()).toEqual(refreshed.notifications.map((n) => n.message));
    expect(watcher.seen.filter((r) => isListCall(r, 'GET')), 'no refetch should be required').toEqual([]);
    expect(refreshed.totalUndismissed).toBe(before.totalUndismissed - 1);
    await expect(nc.panelHeaderText(), 'the popover stays open').toBeVisible();
    expect(page.url()).toBe(urlBefore);
    watcher.stop();
  });

  test('TC-NOTUI-032 — a dismissed notification never returns for that user @regression', async ({ page, browser }) => {
    test.skip(!dismissed, 'BLOCKED — TC-NOTUI-031 did not run, so nothing was dismissed');
    const nc = new NotificationCentre(page);

    // Each test gets its own page, so this one starts on about:blank even inside a
    // serial describe — it has to load the app before the bell exists. (Latent since
    // the case was authored: the whole module was gated off behind
    // NOTIFICATIONS_ALLOW_DESTRUCTIVE, so it had never actually executed.)
    const current = await nc.gotoCapturing();
    expect(current.notifications.some((n) => n.id === dismissed!.id), 'returned on a fresh load').toBe(false);
    await nc.open();
    expect(await nc.indexOfMessage(dismissed!.message), 'still absent after a reopen').toBe(-1);

    const afterReload = await nc.reloadCapturing();
    await nc.open();
    expect(await nc.indexOfMessage(dismissed!.message), 'still absent after a reload').toBe(-1);
    expect(afterReload.notifications.some((n) => n.id === dismissed!.id)).toBe(false);
    // No affordance offers to restore, undo or view dismissed notifications (§2.3).
    await expect(nc.panel().getByText(/restore|undo|dismissed/i)).toHaveCount(0);

    // A genuinely fresh sign-in, not just a new context over the saved session.
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await new AppLoginPage(freshPage).loginAsPO();
      const fresh = new NotificationCentre(freshPage);
      const freshList = await fresh.gotoCapturing();
      expect(freshList.notifications.some((n) => n.id === dismissed!.id), 'returned after a fresh sign-in').toBe(false);
      await fresh.open();
      expect(await fresh.indexOfMessage(dismissed!.message)).toBe(-1);
    } finally {
      await freshContext.close();
    }
  });

  test('TC-NOTUI-033 — dismissing a row leaves the other user\'s panel and badge untouched @regression', async ({
    page,
    browser,
  }) => {
    test.skip(!hasManagerSession(), 'BLOCKED — no Procurement Manager session (set PM_EMAIL/PM_PASSWORD so auth.setup saves pm.json)');
    const po = new NotificationCentre(page);
    const poList = await po.gotoCapturing();
    test.skip(poList.notifications.length === 0, 'BLOCKED — fixture exhausted: no undismissed notification remains');

    const managerContext = await browser.newContext({ storageState: PM_STATE });
    try {
      const managerPage = await managerContext.newPage();
      const manager = new NotificationCentre(managerPage);
      const managerBefore = await manager.gotoCapturing();
      await manager.open();
      const managerMessagesBefore = await manager.renderedMessages();
      const managerBadgeBefore = await manager.badgeText();
      const managerDotsBefore = await manager.unreadDots().count();
      await manager.closeWithEscape();

      // Notifications are per-user rows (see TC-NOTUI-004), so a row shared between
      // the two users is one with the same `kind` + `referenceId`, not the same `id`
      // — and the windows do not always overlap at all. Prefer a shared row, since it
      // is the sharper proof of isolation, but fall back to any row: dismissing ANY
      // of the Owner's notifications must still leave the Manager's panel untouched.
      const key = (n: NotificationDto): string => `${n.kind}:${n.referenceId}`;
      const managerKeys = new Set(managerBefore.notifications.map(key));
      const shared = poList.notifications.find((n) => managerKeys.has(key(n))) ?? poList.notifications[0]!;
      const index = poList.notifications.findIndex((n) => n.id === shared.id);

      await po.open();
      await po.dismissRow(index);
      expect(await po.indexOfMessage(shared.message)).toBe(-1);

      const managerWatcher = watchNotificationRequests(managerPage);
      const managerAfter = await manager.reloadCapturing();
      await manager.open();
      expect(await manager.renderedMessages(), "the Manager's list must be identical").toEqual(managerMessagesBefore);
      expect(managerAfter.unreadCount).toBe(managerBefore.unreadCount);
      expect(managerAfter.totalUndismissed).toBe(managerBefore.totalUndismissed);
      expect(await manager.badgeText()).toBe(managerBadgeBefore);
      expect(await manager.unreadDots().count()).toBe(managerDotsBefore);
      expect(
        managerWatcher.seen.filter((r) => !isListCall(r, 'GET') && !r.path.endsWith(NotificationsApiPaths.stream)),
        "the Manager's context issued a request other than its own GET",
      ).toEqual([]);
      managerWatcher.stop();
    } finally {
      await managerContext.close();
    }
  });

  test('TC-NOTUI-034 — dismissing an unread row decrements the badge by one @regression', async ({ page }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const target = firstUnread(list);
    test.skip(!target, 'BLOCKED — no unread notification remains on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    const before = list.unreadCount;
    // `before - 1` only holds when nothing is queued behind the 20-row window. On QA a
    // backlog exists, so dismissing an unread row backfills another — which may itself
    // be unread, leaving the count level. Then the contract is the weaker but still
    // real one: the count never RISES, and the badge matches whatever the server said.
    const hadBacklog = list.totalUndismissed > list.notifications.length;

    await nc.open();
    await expect(nc.rowUnreadDot(index)).toHaveCount(1);
    const refreshed = await nc.dismissRow(index);

    if (hadBacklog) expect(refreshed.unreadCount).toBeLessThanOrEqual(before);
    else expect(refreshed.unreadCount).toBe(before - 1);
    if (refreshed.unreadCount === 0) await expect.poll(async () => nc.isBadgeVisible()).toBe(false);
    else await expect.poll(async () => nc.badgeText()).toBe(String(refreshed.unreadCount));
    expect(await nc.indexOfMessage(target!.message)).toBe(-1);
  });

  test('TC-NOTUI-035 — dismissing an already-read row leaves the badge unchanged @regression', async ({
    page,
    request,
  }) => {
    const nc = new NotificationCentre(page);
    let list = await nc.gotoCapturing();
    test.skip(list.notifications.length === 0, 'BLOCKED — fixture exhausted: no undismissed notification remains');
    if (!list.notifications.some((n) => n.isRead)) {
      await nc.markReadViaApi(request, list.notifications[0]!.id);
      list = await nc.reloadCapturing();
    }
    const target = firstRead(list);
    test.skip(!target, 'BLOCKED — no read notification on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    const before = list.unreadCount;
    const badgeBefore = await nc.badgeText();

    await nc.open();
    await expect(nc.rowUnreadDot(index)).toHaveCount(0);
    const refreshed = await nc.dismissRow(index);

    // Spec §3.2: unreadCount counts the unread rows WITHIN the returned 20, so when a
    // backlog backfills the vacated slot the count can rise. What removing a READ row
    // may never do is LOWER it — that is the actual claim of this case.
    const hadBacklog = list.totalUndismissed > list.notifications.length;
    if (hadBacklog) {
      expect(refreshed.unreadCount, 'dismissing a read row must not lower unreadCount').toBeGreaterThanOrEqual(before);
      await expect.poll(async () => nc.badgeText()).toBe(String(refreshed.unreadCount));
    } else {
      expect(refreshed.unreadCount, 'dismissing a read row must not move unreadCount').toBe(before);
      expect(await nc.badgeText()).toBe(badgeBefore);
    }
    expect(refreshed.totalUndismissed).toBe(list.totalUndismissed - 1);
    expect(await nc.indexOfMessage(target!.message)).toBe(-1);
  });

  test('TC-NOTUI-037 — the dismiss control does not trigger the row\'s own click action @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    const target = list.notifications.find((n) => n.isRecordAvailable);
    test.skip(!target, 'BLOCKED — no available notification remains on this run');
    const index = list.notifications.findIndex((n) => n.id === target!.id);
    const urlBefore = page.url();

    await nc.open();
    const watcher = watchNotificationRequests(page);
    await nc.dismissRow(index);

    expect(page.url(), 'the dismiss click must not navigate (stopPropagation guard)').toBe(urlBefore);
    expect(watcher.seen.filter(isReadCall), "the row's mark-as-read path must not fire").toEqual([]);
    expect(watcher.seen.filter(isDismissCall)).toHaveLength(1);
    await expect(nc.panelHeaderText(), 'the popover stays open').toBeVisible();
    expect(await nc.indexOfMessage(target!.message)).toBe(-1);
    watcher.stop();
  });

  test('TC-NOTUI-040 — EC-02: dismissing the last visible row shows the empty state immediately @smoke @regression', async ({
    page,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(
      list.totalUndismissed !== 1,
      `BLOCKED — EC-02 needs exactly one undismissed notification and nothing hidden; this run has ${list.totalUndismissed} (the five-row dev fixture is consumed by the dismiss cases above)`,
    );

    await nc.open();
    await expect(nc.rows()).toHaveCount(1);
    const refreshed = await nc.dismissRow(0);

    expect(refreshed.notifications).toEqual([]);
    expect(refreshed.unreadCount).toBe(0);
    expect(refreshed.totalUndismissed).toBe(0);
    // "Immediately" is the point: assert inside the STILL-OPEN popover, no reopen.
    await expect(nc.panelHeaderText()).toBeVisible();
    await expect(nc.rows()).toHaveCount(0);
    await expect(nc.emptyDescription()).toHaveText(NotificationsCopy.empty);
    await expect(nc.clearAllButton()).toBeDisabled();
    expect(await nc.isBadgeVisible()).toBe(false);
  });

  test('TC-NOTUI-038 — "Clear all" dismisses every visible notification and shows the empty state @regression', async ({
    page,
    request,
  }) => {
    const nc = new NotificationCentre(page);
    let list = await nc.gotoCapturing();
    test.skip(list.totalUndismissed === 0, 'BLOCKED — fixture exhausted: the panel is already empty');
    if (!list.notifications.some((n) => n.isRead) && list.notifications.length > 1) {
      await nc.markReadViaApi(request, list.notifications[0]!.id);
      list = await nc.reloadCapturing();
    }

    await nc.open();
    const watcher = watchNotificationRequests(page);
    const refreshed = await nc.clearAll();

    const clearCalls = watcher.seen.filter((r) => isListCall(r, 'DELETE'));
    expect(clearCalls, 'exactly one DELETE on the bare list path').toHaveLength(1);
    expect(refreshed).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
    await expect(nc.rows()).toHaveCount(0);
    await expect(nc.emptyDescription()).toHaveText(NotificationsCopy.empty);
    expect(await nc.isBadgeVisible()).toBe(false);
    watcher.stop();

    await nc.closeWithEscape();
    const reopened = await nc.gotoCapturing();
    await nc.open();
    expect(reopened.notifications).toEqual([]);
    expect(reopened.totalUndismissed).toBe(0);
    await expect(nc.emptyDescription()).toHaveText(NotificationsCopy.empty);
  });

  test('TC-NOTUI-041 — "Clear all" is disabled once there is nothing left to clear @regression', async ({
    page,
    browser,
  }) => {
    const nc = new NotificationCentre(page);
    const list = await nc.gotoCapturing();
    test.skip(list.totalUndismissed !== 0, 'BLOCKED — the panel still holds notifications (run after TC-NOTUI-038/040)');

    await nc.open();
    await expect(nc.clearAllButton()).toBeDisabled();
    const watcher = watchNotificationRequests(page);
    // dispatchEvent, not click(): a disabled AntD button would fail Playwright's
    // actionability wait, and the point is that the click has no effect.
    await nc.clearAllButton().dispatchEvent('click');
    expect(watcher.seen.filter((r) => isListCall(r, 'DELETE')), 'a disabled Clear all must issue no DELETE').toEqual([]);
    watcher.stop();
    await expect(nc.emptyDescription()).toHaveText(NotificationsCopy.empty);

    // The disabled state tracks totalUndismissed — it is not a property of the control.
    test.skip(!hasManagerSession(), 'BLOCKED — no Manager session for the enabled-state comparison');
    const managerContext = await browser.newContext({ storageState: PM_STATE });
    try {
      const managerPage = await managerContext.newPage();
      const manager = new NotificationCentre(managerPage);
      const managerList = await manager.gotoCapturing();
      test.skip(managerList.totalUndismissed === 0, "BLOCKED — the Manager's panel is empty too");
      await manager.open();
      await expect(manager.clearAllButton()).toBeEnabled();
    } finally {
      await managerContext.close();
    }
  });

  test('TC-NOTUI-042 — "Clear all" changes no other user\'s panel or badge @regression', async ({ page, browser }) => {
    test.skip(!hasManagerSession(), 'BLOCKED — no Procurement Manager session (set PM_EMAIL/PM_PASSWORD so auth.setup saves pm.json)');
    const po = new NotificationCentre(page);
    const poList = await po.gotoCapturing();
    test.skip(poList.totalUndismissed === 0, 'BLOCKED — fixture exhausted: the Owner has nothing left to clear');

    const managerContext = await browser.newContext({ storageState: PM_STATE });
    try {
      const managerPage = await managerContext.newPage();
      const manager = new NotificationCentre(managerPage);
      const managerBefore = await manager.gotoCapturing();
      await manager.open();
      const managerMessagesBefore = await manager.renderedMessages();
      const managerBadgeBefore = await manager.badgeText();
      const managerDotsBefore = await manager.unreadDots().count();
      await manager.closeWithEscape();

      await po.open();
      await po.clearAll();
      await expect(po.rows()).toHaveCount(0);
      await expect(po.emptyDescription()).toHaveText(NotificationsCopy.empty);
      expect(await po.isBadgeVisible()).toBe(false);

      const managerWatcher = watchNotificationRequests(managerPage);
      const managerAfter = await manager.reloadCapturing();
      await manager.open();
      expect(await manager.renderedMessages()).toEqual(managerMessagesBefore);
      expect(managerAfter.unreadCount).toBe(managerBefore.unreadCount);
      expect(managerAfter.totalUndismissed).toBe(managerBefore.totalUndismissed);
      expect(await manager.badgeText()).toBe(managerBadgeBefore);
      expect(await manager.unreadDots().count(), "the Owner's clear-all marked nothing read for the Manager").toBe(
        managerDotsBefore,
      );
      expect(
        managerWatcher.seen.filter((r) => !isListCall(r, 'GET') && !r.path.endsWith(NotificationsApiPaths.stream)),
        "the Manager's context issued a request other than its own GET",
      ).toEqual([]);
      managerWatcher.stop();
    } finally {
      await managerContext.close();
    }
  });

  /**
   * Declared last on purpose: after the clear-all cases `unreadCount` is genuinely 0,
   * so the badge-hidden state is reached without spending PATCHes. When rows survive
   * (an earlier case skipped), the case falls back to marking every one read — which
   * is itself irreversible (there is no un-read endpoint), hence its place here.
   */
  test('TC-NOTUI-003 — the badge is hidden when unreadCount is 0 @regression', async ({ page, request }) => {
    const nc = new NotificationCentre(page);
    let list = await nc.gotoCapturing();
    if (list.unreadCount > 0) {
      for (const notification of list.notifications.filter((n) => !n.isRead)) {
        await nc.markReadViaApi(request, notification.id);
      }
      list = await nc.reloadCapturing();
    }

    expect(list.unreadCount).toBe(0);
    await expect(nc.bell(), 'the bell itself stays present and enabled').toBeVisible();
    await expect(nc.bell()).toBeEnabled();
    // "Hidden" is observable as the ABSENCE of the Badge wrapper and of any count text.
    await expect(nc.badge()).toHaveCount(0);
    expect(await nc.badgeText()).toBeNull();
  });

  // ── blocked in this environment ─────────────────────────────────────────────

  test('TC-NOTUI-036 — dismissing a row backfills the nearest notification hidden behind the 20-item limit @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10: 512 undismissed notifications behind a 20-row window,
    // so a dismissal has something real to backfill from.
    const nc = new NotificationCentre(page);
    const before = await nc.gotoCapturing();
    test.skip(
      before.totalUndismissed <= PanelGeometry.visibleWindow,
      'BLOCKED — nothing is hidden behind the 20-item limit on this run',
    );
    expect(before.totalUndismissed).toBeGreaterThan(PanelGeometry.visibleWindow);
    await nc.open();
    await expect(nc.rows()).toHaveCount(PanelGeometry.visibleWindow);
    const visibleBefore = await nc.renderedMessages();

    const refreshed = await nc.dismissRow(0);
    expect(refreshed.notifications).toHaveLength(PanelGeometry.visibleWindow);
    await expect(nc.rows()).toHaveCount(PanelGeometry.visibleWindow);
    // The backfilled row appears at the position BR-01 gives it — asserted as fidelity
    // to the server's array, never re-derived here.
    expect(await nc.renderedMessages()).toEqual(refreshed.notifications.map((n) => n.message));
    expect(await nc.indexOfMessage(visibleBefore[0]!)).toBe(-1);
    expect(refreshed.totalUndismissed).toBe(before.totalUndismissed - 1);
    if (refreshed.unreadCount === 0) expect(await nc.isBadgeVisible()).toBe(false);
    else expect(await nc.badgeText()).toBe(String(refreshed.unreadCount));
  });

  test('TC-NOTUI-039 — "Clear all" also dismisses notifications hidden behind the 20-item limit @regression', async ({
    page,
  }) => {
    // Unblocked on QA 2026-09-10 — there is now a backlog behind the window to clear.
    // TC-NOTUI-038 already performs the same clear-all against this tenant, so running
    // this adds no destruction beyond what the suite already does.
    const nc = new NotificationCentre(page);
    const before = await nc.gotoCapturing();
    test.skip(
      before.totalUndismissed <= PanelGeometry.visibleWindow,
      'BLOCKED — nothing is hidden behind the 20-item limit on this run',
    );
    expect(before.totalUndismissed).toBeGreaterThan(PanelGeometry.visibleWindow);
    await nc.open();
    const refreshed = await nc.clearAll();
    expect(refreshed).toEqual({ notifications: [], unreadCount: 0, totalUndismissed: 0 });
    await expect(nc.emptyDescription()).toHaveText(NotificationsCopy.empty);

    const afterReload = await nc.reloadCapturing();
    expect(afterReload.notifications, 'a hidden notification must not backfill after a clear-all').toEqual([]);
    expect(afterReload.totalUndismissed).toBe(0);
    expect(await nc.isBadgeVisible()).toBe(false);
  });
});

// The as-built panel error state ("Couldn't load notifications. Try again shortly.")
// is deliberately NOT asserted anywhere in this file: the spec defines no panel error
// state and no error copy, so it is developer-chosen placeholder copy pending
// clarifications Q-E1/Q-F1. It is exported from the fixture only so a future case can
// recognise the state once the copy is ratified.
void NotificationsAsBuilt;
