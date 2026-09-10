/**
 * Page Object — CEIQ-FEAT-011 Dashboard (/dashboard).
 *
 * The Dashboard ships NO `data-testid` attributes (verified against
 * clearedge-frontend@origin/qa), so every locator here is anchored to AntD
 * structure plus the visible copy the spec itself mandates. That is a deliberate
 * trade rather than an oversight: the copy is under test anyway, so a copy change
 * that breaks a locator is a change the suite *should* notice. The proposed
 * attribute contract lives in tests/fixtures/expectedCopyDashboard.ts (gap G-1).
 *
 * Responses are captured rather than recomputed: the API suite owns whether a
 * number is CORRECT; this layer owns whether the number the API returned is the
 * number on screen.
 */
import { type Page, type Locator, type Response, expect } from '@playwright/test';
import { DashboardCopy, DashboardApi } from '../tests/fixtures/expectedCopyDashboard';
import { appBaseUrl } from '../utils/env';

export interface SummaryPayload {
  contracts: { all: number; expiringIn30Days: number; inReview: number };
  sourcing: { all: number; closingInAWeek: number };
  deadlines: {
    rfp: { id: string; type: string; title: string; submissionDeadline: string } | null;
    rfq: { id: string; type: string; title: string; submissionDeadline: string } | null;
  };
  canCreate: boolean;
}

export class DashboardPage {
  constructor(private readonly page: Page) {}

  private appUrl(path = DashboardCopy.route): string {
    return `${appBaseUrl().replace(/\/$/, '')}${path}`;
  }

  // ── navigation ─────────────────────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.page.goto(this.appUrl());
    await this.expectLanded();
  }

  /**
   * Load the Dashboard while capturing one endpoint's response. Waiting on the
   * response promise BEFORE navigating avoids the race where a fast reply lands
   * before the listener attaches.
   */
  async gotoCapturing<T>(urlGlob: string): Promise<T> {
    const waiting = this.page.waitForResponse((r: Response) => this.matches(r.url(), urlGlob) && r.status() === 200);
    await this.page.goto(this.appUrl());
    const res = await waiting;
    const body = (await res.json()) as { data: T };
    await this.expectLanded();
    return body.data;
  }

  /** Glob matcher for the `**\/path*` shapes in DashboardApi. */
  private matches(url: string, glob: string): boolean {
    const fragment = glob.replace(/^\*\*/, '').replace(/\*$/, '');
    return url.includes(fragment);
  }

  async expectLanded(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`${DashboardCopy.route}(\\b|$|\\?)`));
    await expect(this.headerTitle()).toBeVisible();
  }

  /** The `now` query param the page sent on this load — the §4.1 reference instant. */
  static nowParam(url: string): string | null {
    try {
      return new URL(url).searchParams.get('now');
    } catch {
      return null;
    }
  }

  // ── header ─────────────────────────────────────────────────────────────────

  headerTitle(): Locator {
    return this.page.getByRole('heading', { name: DashboardCopy.header.title, exact: true }).first();
  }

  headerSubtitle(): Locator {
    return this.page.getByText(DashboardCopy.header.subtitle, { exact: true });
  }

  // ── summary panels ─────────────────────────────────────────────────────────

  /**
   * A summary panel, located by its own label. The two panels are sibling AntD
   * columns; `.ant-col` scoping keeps "Contracts" from also matching the word
   * where it appears in the sidebar or elsewhere on the page.
   */
  panel(which: 'contracts' | 'sourcing'): Locator {
    const label = which === 'contracts' ? DashboardCopy.panels.contracts : DashboardCopy.panels.sourcing;
    return this.page
      .locator('.ant-col')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: DashboardCopy.panels.createNew }).or(this.page.locator('div')) })
      .first();
  }

  /** The large headline count inside a panel (32 px Typography.Text — the only display-size text there). */
  headlineCount(which: 'contracts' | 'sourcing'): Locator {
    return this.panel(which).locator('span.ant-typography').filter({ hasText: /^(\d[\d,]*|—)$/ }).first();
  }

  subTile(label: string): Locator {
    return this.page.locator('div').filter({ has: this.page.getByText(label, { exact: true }) }).last();
  }

  /** The numeric (or em-dash) value rendered inside a sub-tile. */
  subTileValue(label: string): Locator {
    return this.subTile(label).locator('span.ant-typography').filter({ hasText: /^(\d[\d,]*|—)$/ }).last();
  }

  createNewButton(which: 'contracts' | 'sourcing'): Locator {
    return this.panel(which).getByRole('button', { name: DashboardCopy.panels.createNew, exact: true });
  }

  deadlinesTile(): Locator {
    return this.page
      .locator('div')
      .filter({ has: this.page.getByText(DashboardCopy.panels.deadlinesTile, { exact: true }) })
      .last();
  }

  /**
   * One Deadlines row. Anchored on the AntD `Tag` carrying the type, then narrowed
   * to the ancestor that also holds the row's value — the date suffix "CT" when the
   * type has a qualifying event, or the em-dash when it does not. Without that second
   * filter the locator resolves to the inner title group, which carries the tag but
   * not the date, and the case then asserts against half a row.
   */
  deadlineRow(type: 'RFP' | 'RFQ'): Locator {
    return this.deadlinesTile()
      .locator('div')
      .filter({ has: this.page.locator('.ant-tag', { hasText: new RegExp(`^${type}$`) }) })
      .filter({ hasText: /CT|—/ })
      .last();
  }

  // ── recent activity ────────────────────────────────────────────────────────

  recentActivityCard(): Locator {
    return this.page
      .locator('.ant-card')
      .filter({ has: this.page.getByText(DashboardCopy.recentActivity.title, { exact: true }) })
      .first();
  }

  recentActivityItems(): Locator {
    return this.recentActivityCard().locator('.ant-card-body > .ant-row > .ant-col');
  }

  recentActivityEmpty(): Locator {
    return this.recentActivityCard().getByText(DashboardCopy.recentActivity.empty, { exact: true });
  }

  // ── calendar ───────────────────────────────────────────────────────────────

  /** The calendar card — identified by whichever of its three views is mounted. */
  calendarCard(): Locator {
    return this.page
      .locator('.ant-card')
      .filter({
        has: this.page
          .getByText(DashboardCopy.calendar.listHeader, { exact: true })
          .or(this.page.locator('.ant-picker')),
      })
      .first();
  }

  calendarListHeader(): Locator {
    return this.page.getByText(DashboardCopy.calendar.listHeader, { exact: true });
  }

  calendarControl(title: string): Locator {
    return this.calendarCard().locator(`button[title="${title}"]`);
  }

  calendarLegend(which: 'contract' | 'sourcing'): Locator {
    const text = which === 'contract' ? DashboardCopy.calendar.legendContract : DashboardCopy.calendar.legendSourcing;
    return this.calendarCard().getByText(text, { exact: true });
  }

  /** List-view date-group headings, e.g. "Monday, 09/08/2026" (uppercased by CSS only). */
  listDateGroups(): Locator {
    return this.calendarCard().locator('div').filter({ hasText: /^[A-Za-z]+day, \d{2}\/\d{2}\/\d{4}$/ });
  }

  listEmpty(): Locator {
    return this.calendarCard().getByText(DashboardCopy.calendar.emptyList, { exact: true });
  }

  /** Week view's seven day cells. */
  weekCells(): Locator {
    return this.calendarCard().locator('div[style*="grid-template-columns"] > div');
  }

  weekRangeLabel(): Locator {
    return this.calendarCard().getByText(/^\d{1,2}\/\d{1,2}\/\d{4} – \d{1,2}\/\d{1,2}\/\d{4}$/);
  }

  monthTable(): Locator {
    return this.calendarCard().locator('table');
  }

  monthHeaderCells(): Locator {
    return this.monthTable().locator('thead th');
  }

  monthDayCells(): Locator {
    return this.monthTable().locator('tbody td');
  }

  monthMoreLabel(): Locator {
    return this.monthTable().getByText(/^\+\d+ more$/);
  }

  monthPicker(): Locator {
    return this.calendarCard().locator('.ant-picker');
  }

  /**
   * Drive the month/year picker to a specific month, e.g. "February 2026".
   *
   * AntD's MONTH panel has no single-step prev/next — only the super (year) arrows
   * `.ant-picker-header-super-prev-btn` / `-super-next-btn`. Using the day panel's
   * `.ant-picker-header-prev-btn` here silently does nothing, leaving the picker on
   * the current year while the test believes it navigated.
   */
  async pickMonth(label: string): Promise<void> {
    await this.monthPicker().click();
    const [monthName, year] = label.split(' ');
    // `:not(.ant-picker-dropdown-hidden)` rather than a `hasNot` filter — AntD puts
    // the hidden class on the dropdown ITSELF, and `hasNot` only inspects descendants,
    // so the filter would happily return a closed dropdown from a previous open.
    const dropdown = this.page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)').last();
    await expect(dropdown.locator('.ant-picker-year-btn').first()).toBeVisible();

    for (let i = 0; i < 24; i++) {
      const shown = (await dropdown.locator('.ant-picker-year-btn').first().textContent())?.trim();
      if (shown === year) break;
      const dir = Number(shown) > Number(year) ? '.ant-picker-header-super-prev-btn' : '.ant-picker-header-super-next-btn';
      await dropdown.locator(dir).first().click();
    }
    const shownYear = (await dropdown.locator('.ant-picker-year-btn').first().textContent())?.trim();
    expect(shownYear, `the month picker did not reach ${year}`).toBe(year);

    await dropdown
      .locator('.ant-picker-cell-inner')
      .filter({ hasText: new RegExp(`^${monthName!.slice(0, 3)}`, 'i') })
      .first()
      .click();

    // Assert the OUTCOME (the picker now shows the requested month), not that the AntD dropdown
    // element disappeared. The old `expect(dropdown).toBeHidden()` was flaky — TC-DASHUI-056
    // failed-then-passed on retry, 2026-09-10 — because `dropdown` is a `.last()` locator that
    // re-resolves on every poll, so AntD keeping any dropdown node mounted made it look visible
    // forever. What the caller needs is that the month changed; Escape then clears any leftover
    // overlay so the next interaction is not blocked by it.
    // `.ant-picker` is the wrapper div, not the <input> — read the input inside it.
    await expect(this.monthPicker().locator('input').first()).toHaveValue(
      new RegExp(`${monthName!.slice(0, 3)}`, 'i'),
    );
    // Escape, then confirm no OPEN dropdown remains. Without settling here the next pickMonth()
    // can click through a stale overlay — which is how TC-DASHUI-057 flaked on 2026-09-10 even
    // after TC-DASHUI-056 was stabilised.
    await this.page.keyboard.press('Escape');
    await this.page
      .locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)')
      .first()
      .waitFor({ state: 'hidden', timeout: 5_000 })
      .catch(() => {
        /* AntD may unmount it outright — either way there is nothing left to click through */
      });
  }

  async goToWeekView(): Promise<void> {
    await this.calendarControl(DashboardCopy.calendar.expandToWeek).click();
    await expect(this.weekRangeLabel()).toBeVisible();
  }

  async goToMonthView(): Promise<void> {
    await this.goToWeekView();
    await this.calendarControl(DashboardCopy.calendar.expandToMonth).click();
    await expect(this.monthTable()).toBeVisible();
  }

  // ── side panels ────────────────────────────────────────────────────────────

  card(title: string): Locator {
    return this.page.locator('.ant-card').filter({ has: this.page.getByText(title, { exact: true }) }).first();
  }

  renewalsCard(): Locator {
    return this.card(DashboardCopy.renewals.title);
  }

  activeSourcingCard(): Locator {
    return this.card(DashboardCopy.activeSourcing.title);
  }

  listRows(card: Locator): Locator {
    return card.locator('.ant-list-item');
  }

  /**
   * Resolve once the Renewals and Active Sourcing panels have finished loading.
   *
   * Waits for the skeleton to clear, NOT for a row to appear. A panel with no data renders no
   * rows at all — on QA 2026-09-10 "Expiring in 30 days" was 0, so Renewals was legitimately
   * empty — and a layout assertion must not depend on the tenant happening to hold data.
   */
  async waitForPanelsSettled(timeout = 15_000): Promise<void> {
    for (const card of [this.renewalsCard(), this.activeSourcingCard()]) {
      await card.waitFor({ state: 'visible', timeout });
      await card.locator('.ant-skeleton').first().waitFor({ state: 'detached', timeout }).catch(() => {
        /* no skeleton rendered — already settled */
      });
    }
  }

  viewAll(card: Locator): Locator {
    return card.getByRole('button', { name: DashboardCopy.renewals.viewAll, exact: true });
  }

  errorAlert(scope?: Locator): Locator {
    return (scope ?? this.page).locator('.ant-alert-error');
  }
}
