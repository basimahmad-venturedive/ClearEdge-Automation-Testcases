/**
 * Page Object — CEIQ-FEAT-012 Notification Centre (header bell + AntD Popover panel).
 *
 * Anchored on the as-built DOM of `clearedge-frontend@origin/dev` `5201250`
 * (2026-09-04), exactly as pinned by testcases/TC-CEIQ-FEAT-012.md §6:
 *
 *   bell      button[aria-label="Notifications"]      (AntD text/circle Button)
 *   badge     .ant-badge wrapper, present ONLY when unreadCount > 0
 *   panel     AntD Popover, trigger="click", placement="bottomRight", 400 px
 *   header    strong text "Notifications" + link Button "Clear all"
 *   list      scroll div (max-height 380px, overflow-y auto)
 *   row       [data-testid="notification-row"]
 *   dot       [data-testid="notification-unread-dot"]   (only when isRead === false)
 *   icon      [data-testid="notification-type-icon"]
 *   dismiss   button[aria-label="Dismiss notification"]  (handler stopPropagation()s)
 *
 * Inside a row the message and the label pill are both `Typography.Text`
 * (`span.ant-typography`) in that order, and the unavailable-record text is the
 * `type="secondary"` variant that REPLACES the pill — which is why the pill is
 * located as "the second non-secondary typography span", not by a class of its own.
 *
 * The panel is a portal: it is NOT inside the header, so every panel-scoped locator
 * hangs off `panel()` rather than the bell.
 *
 * Division of labour: the API suite owns whether a derived value is CORRECT (order,
 * window, unreadCount, relativeLabel, isRecordAvailable); this layer only owns
 * whether the value the API returned is the value on screen. Every helper here
 * therefore CAPTURES the response instead of recomputing it.
 */
import { type APIRequestContext, type Locator, type Page, type Response, expect } from '@playwright/test';
import {
  NotificationSelectors,
  NotificationsApiPaths,
  NotificationsCopy,
} from '../tests/fixtures/expectedCopyNotifications';
import { appApiBaseUrl, appBaseUrl } from '../utils/env';

/** Endpoint #1's notification object (Tech §3.2 — the twelve keys). */
export interface NotificationDto {
  id: string;
  kind: number;
  message: string;
  relativeLabel: string;
  eventDate: string;
  createdAt: string;
  isRead: boolean;
  isRecordAvailable: boolean;
  referenceType: 'contract' | 'sourcing_event';
  referenceId: string;
  destinationTab: string;
  iconColor: 'amber' | 'red' | 'teal';
}

/** The `data` object endpoints #1, #3 and #4 all return. */
export interface NotificationListDto {
  notifications: NotificationDto[];
  unreadCount: number;
  totalUndismissed: number;
}

/** `URL.pathname`, or the raw string when it is not a parsable URL. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export class NotificationCentre {
  private readonly apiBase: string;

  constructor(private readonly page: Page) {
    // Fails loud when APP_API_BASE_URL is missing — never falls back to a default.
    this.apiBase = appApiBaseUrl().replace(/\/$/, '');
  }

  // ── request/response matching (path-only, so it holds on any environment) ───

  /** Endpoint #1/#4 — the EXACT list path; excludes `/:id`, `/:id/read` and `/stream`. */
  isListPath(url: string): boolean {
    return pathOf(url).endsWith(NotificationsApiPaths.list);
  }

  /** Endpoint #3 — `/v1/notifications/:id` (never `/read`, never the bare list). */
  isItemPath(url: string, id?: string): boolean {
    const path = pathOf(url);
    if (id) return path.endsWith(`${NotificationsApiPaths.list}/${id}`);
    return new RegExp(`${NotificationsApiPaths.list}/[^/]+$`).test(path);
  }

  /** Endpoint #2 — `/v1/notifications/:id/read`. */
  isReadPath(url: string, id?: string): boolean {
    const path = pathOf(url);
    if (id) return path.endsWith(`${NotificationsApiPaths.list}/${id}${NotificationsApiPaths.readSuffix}`);
    return new RegExp(`${NotificationsApiPaths.list}/[^/]+${NotificationsApiPaths.readSuffix}$`).test(path);
  }

  /** True for any notification-family request (used by the "nothing else fired" assertions). */
  isNotificationPath(url: string): boolean {
    return pathOf(url).includes(NotificationsApiPaths.list);
  }

  private async listBody(response: Response): Promise<NotificationListDto> {
    const body = (await response.json()) as { data: NotificationListDto };
    return body.data;
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  appUrl(path = '/dashboard'): string {
    return `${appBaseUrl().replace(/\/$/, '')}${path}`;
  }

  async goto(path = '/dashboard'): Promise<void> {
    await this.page.goto(this.appUrl(path));
    await expect(this.bell()).toBeVisible();
  }

  /**
   * Load an authenticated page while capturing the `GET /v1/notifications` this
   * load issues. The listener is attached BEFORE navigating so a fast reply can't
   * land first.
   */
  async gotoCapturing(path = '/dashboard'): Promise<NotificationListDto> {
    const waiting = this.waitForList('GET');
    await this.page.goto(this.appUrl(path));
    const data = await waiting;
    await expect(this.bell()).toBeVisible();
    return data;
  }

  /** Reload, capturing the fresh panel state the reload fetches. */
  async reloadCapturing(): Promise<NotificationListDto> {
    const waiting = this.waitForList('GET');
    await this.page.reload();
    const data = await waiting;
    await expect(this.bell()).toBeVisible();
    return data;
  }

  /** Promise resolving with the next 200 response on the exact list path for `method`. */
  waitForList(method: 'GET' | 'DELETE'): Promise<NotificationListDto> {
    return this.page
      .waitForResponse((r) => this.isListPath(r.url()) && r.request().method() === method && r.status() === 200)
      .then((r) => this.listBody(r));
  }

  // ── bell and badge ─────────────────────────────────────────────────────────

  bell(): Locator {
    return this.page.locator(NotificationSelectors.bell);
  }

  /** The AntD Badge that WRAPS the bell. Absent (count 0) is the observable form of "badge hidden". */
  badge(): Locator {
    return this.page.locator(NotificationSelectors.badge).filter({ has: this.bell() });
  }

  async isBadgeVisible(): Promise<boolean> {
    if ((await this.badge().count()) === 0) return false;
    return this.badge().first().isVisible();
  }

  /**
   * The badge's rendered text, or null when no Badge wrapper exists. The bell button
   * itself is icon-only, so the wrapper's text content IS the count — which is also
   * what makes the "single legible number" assertion (TC-NOTUI-006) meaningful.
   */
  async badgeText(): Promise<string | null> {
    if (!(await this.isBadgeVisible())) return null;
    return ((await this.badge().first().textContent()) ?? '').trim();
  }

  async badgeCount(): Promise<number | null> {
    const text = await this.badgeText();
    return text === null || text === '' ? null : Number(text);
  }

  /** The custom count element AntD renders for an element `count` (structure assertions only). */
  badgeCountElement(): Locator {
    return this.badge().locator('.ant-scroll-number-custom-component, .ant-badge-count').first();
  }

  // ── panel ──────────────────────────────────────────────────────────────────

  /** The open popover — identified by the header text the spec mandates. */
  panel(): Locator {
    return this.page
      .locator(NotificationSelectors.popover)
      .filter({ has: this.page.getByText(NotificationsCopy.panelHeader, { exact: true }) })
      .last();
  }

  /** The 400 px content div the panel component renders. */
  panelBody(): Locator {
    return this.panel().locator('div[style*="400px"]').first();
  }

  panelHeaderText(): Locator {
    return this.panel().getByText(NotificationsCopy.panelHeader, { exact: true });
  }

  clearAllButton(): Locator {
    return this.panel().getByRole('button', { name: NotificationsCopy.clearAll, exact: true });
  }

  /** Tech §6.2 — the row list's own scroll container (max-height 380 px, overflow-y auto). */
  scrollContainer(): Locator {
    return this.panel().locator(NotificationSelectors.scrollContainer).first();
  }

  emptyState(): Locator {
    return this.panel().locator(NotificationSelectors.empty);
  }

  emptyDescription(): Locator {
    return this.panel().locator(NotificationSelectors.emptyDescription);
  }

  /** As-built error state — recognised, never asserted as a requirement (Q-E1/Q-F1). */
  errorText(): Locator {
    return this.panel().locator(NotificationSelectors.dangerText);
  }

  async isPanelOpen(): Promise<boolean> {
    return (await this.panel().count()) > 0 && (await this.panel().isVisible());
  }

  async open(): Promise<void> {
    await this.bell().click();
    await expect(this.panelHeaderText()).toBeVisible();
  }

  /**
   * Close by clicking OUTSIDE the popover (AC-002). The target must itself be inert,
   * otherwise a failure can't be told apart from "the click hit a real control", so
   * the point is chosen at runtime: candidate points are probed with
   * `document.elementFromPoint` and the first one that is neither inside the popover
   * nor inside any interactive element wins. Returns the point actually clicked.
   */
  async close(): Promise<{ x: number; y: number }> {
    const size = this.page.viewportSize() ?? { width: 1280, height: 720 };
    const candidates = [
      { x: Math.round(size.width / 2), y: size.height - 8 },
      { x: Math.round(size.width / 2), y: Math.round(size.height * 0.75) },
      { x: 8, y: size.height - 8 },
    ];
    const point = await this.page.evaluate((points) => {
      for (const candidate of points) {
        const element = document.elementFromPoint(candidate.x, candidate.y);
        if (!element) continue;
        if (element.closest('.ant-popover')) continue;
        if (element.closest('a, button, input, select, textarea, [role="button"], [data-testid="notification-row"]')) {
          continue;
        }
        return candidate;
      }
      return null;
    }, candidates);
    if (!point) {
      throw new Error(
        'NotificationCentre.close(): no inert outside-click target found in the viewport — ' +
          'every probed point resolved to an interactive element or the popover itself.',
      );
    }
    await this.page.mouse.click(point.x, point.y);
    await expect(this.panelHeaderText()).toHaveCount(0);
    return point;
  }

  /** Close with Escape (AC-002). The key goes to the document with the panel freshly opened. */
  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.panelHeaderText()).toHaveCount(0);
  }

  // ── rows ───────────────────────────────────────────────────────────────────

  rows(): Locator {
    return this.panel().locator(NotificationSelectors.row);
  }

  rowByIndex(index: number): Locator {
    return this.rows().nth(index);
  }

  /** The message line — the first Typography.Text in the row's content column. */
  rowMessage(index: number): Locator {
    return this.rowByIndex(index).locator('span.ant-typography').first();
  }

  /**
   * The relative-label pill — the SECOND non-secondary typography span in the row.
   * Rendered only when `isRecordAvailable` is true; when it is false this locator
   * resolves to nothing and `rowUnavailable()` takes its place.
   */
  rowLabelPill(index: number): Locator {
    return this.rowByIndex(index).locator('span.ant-typography:not(.ant-typography-secondary)').nth(1);
  }

  /** How many label pills a row renders (BR-02 demands exactly one). */
  async rowLabelPillCount(index: number): Promise<number> {
    const spans = await this.rowByIndex(index)
      .locator('span.ant-typography:not(.ant-typography-secondary)')
      .count();
    // The message line is the first of those spans; everything after it is a pill.
    return Math.max(0, spans - 1);
  }

  rowUnavailable(index: number): Locator {
    return this.rowByIndex(index).locator('span.ant-typography-secondary');
  }

  rowUnreadDot(index: number): Locator {
    return this.rowByIndex(index).locator(NotificationSelectors.unreadDot);
  }

  rowTypeIcon(index: number): Locator {
    return this.rowByIndex(index).locator(NotificationSelectors.typeIcon);
  }

  rowDismiss(index: number): Locator {
    return this.rowByIndex(index).locator(NotificationSelectors.dismiss);
  }

  /** Every unread dot currently rendered in the panel. */
  unreadDots(): Locator {
    return this.panel().locator(NotificationSelectors.unreadDot);
  }

  typeIcons(): Locator {
    return this.panel().locator(NotificationSelectors.typeIcon);
  }

  dismissControls(): Locator {
    return this.panel().locator(NotificationSelectors.dismiss);
  }

  /** Whitespace-collapsed full text of a row (message + pill/unavailable text). */
  async rowText(index: number): Promise<string> {
    return ((await this.rowByIndex(index).textContent()) ?? '').replace(/\s+/g, ' ').trim();
  }

  async rowMessageText(index: number): Promise<string> {
    return ((await this.rowMessage(index).textContent()) ?? '').trim();
  }

  async rowLabelText(index: number): Promise<string> {
    return ((await this.rowLabelPill(index).textContent()) ?? '').trim();
  }

  /** Rendered message text of every row, in DOM order. */
  async renderedMessages(): Promise<string[]> {
    const total = await this.rows().count();
    const messages: string[] = [];
    for (let i = 0; i < total; i++) messages.push(await this.rowMessageText(i));
    return messages;
  }

  /** Computed background colour of a row — the unread/read distinction (AC-003). */
  async rowBackground(index: number): Promise<string> {
    return this.rowByIndex(index).evaluate((el) => window.getComputedStyle(el).backgroundColor);
  }

  /** Computed colour of a row's type icon — compared BETWEEN rows, never against a hex. */
  async rowIconColour(index: number): Promise<string> {
    return this.rowTypeIcon(index).evaluate((el) => window.getComputedStyle(el).color);
  }

  /** The AntD icon class on a row's glyph, e.g. `anticon-check-circle`. */
  async rowGlyphClasses(index: number): Promise<string[]> {
    return this.rowTypeIcon(index)
      .locator('.anticon')
      .first()
      .evaluate((el) => Array.from(el.classList));
  }

  /** Index of the row rendering `message`, or -1. */
  async indexOfMessage(message: string): Promise<number> {
    const rendered = await this.renderedMessages();
    return rendered.indexOf(message);
  }

  // ── interactions ───────────────────────────────────────────────────────────

  /**
   * Click the row BODY (the message line), never the dismiss control — the EC-01
   * mechanism only means something when the click lands on the row itself.
   */
  async clickRow(index: number): Promise<void> {
    await this.rowMessage(index).click();
  }

  /** Dismiss row `index` and return the refreshed list the DELETE response carries. */
  async dismissRow(index: number): Promise<NotificationListDto> {
    const waiting = this.page
      .waitForResponse((r) => this.isItemPath(r.url()) && r.request().method() === 'DELETE')
      .then((r) => this.listBody(r));
    await this.rowDismiss(index).click();
    return waiting;
  }

  /** Click "Clear all" and return the refreshed (empty) list the DELETE response carries. */
  async clearAll(): Promise<NotificationListDto> {
    const waiting = this.waitForList('DELETE');
    await this.clearAllButton().click();
    return waiting;
  }

  // ── API side-door (used only where the case says to change state OUT of band) ──

  /**
   * The app's Cognito ID token, read from the persisted Redux store — the same token
   * the SPA sends. Mirrors utils/vendorApi.ts's reader; the PO must already be logged
   * in on this page.
   */
  async idToken(): Promise<string> {
    const token = await this.page.evaluate(() => {
      try {
        const raw = window.localStorage.getItem('persist:ceiq-auth');
        if (!raw) return null;
        const outer = JSON.parse(raw) as Record<string, string>;
        let idToken = outer.idToken;
        try {
          idToken = JSON.parse(idToken) as string;
        } catch {
          /* already a plain string */
        }
        return idToken || null;
      } catch {
        return null;
      }
    });
    if (!token) {
      throw new Error(
        "NotificationCentre: no ID token in localStorage['persist:ceiq-auth'] — the user must be " +
          'logged in on this page before an out-of-band API call.',
      );
    }
    return token;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.idToken()}`, 'Content-Type': 'application/json' };
  }

  /** Endpoint #1 straight from the API — for the "same rows, other user" comparisons. */
  async listViaApi(request: APIRequestContext): Promise<NotificationListDto> {
    const res = await request.get(`${this.apiBase}${NotificationsApiPaths.list}`, {
      headers: await this.authHeaders(),
    });
    if (!res.ok()) throw new Error(`GET ${NotificationsApiPaths.list} failed: ${res.status()} ${await res.text()}`);
    const body = (await res.json()) as { data: NotificationListDto };
    return body.data;
  }

  /**
   * Endpoint #2 out of band. Used where a case needs a read row WITHOUT exercising
   * the AC-004 row click (which also navigates), keeping the two behaviours separable.
   */
  async markReadViaApi(request: APIRequestContext, id: string): Promise<void> {
    const res = await request.patch(
      `${this.apiBase}${NotificationsApiPaths.list}/${id}${NotificationsApiPaths.readSuffix}`,
      { headers: await this.authHeaders() },
    );
    if (!res.ok()) throw new Error(`PATCH ${id}/read failed: ${res.status()} ${await res.text()}`);
  }
}
