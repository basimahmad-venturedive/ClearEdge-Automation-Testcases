/**
 * Page Object — CEIQ-FEAT-008 Vendor Portal (`/portal/:token`).
 * Locators + exact copy: locators/vendorPortal.ts (spec pins no data-testids →
 * role/text locators, `// TODO_LOCATOR: data-testid TBD` markers there).
 *
 * The portal is PUBLIC and unauthenticated (ASM-01): the invitation token in the
 * URL is the sole credential — no login/session. Methods are user-meaningful and
 * build their locators from the map; the spec never touches a raw locator.
 *
 * Base URL: the portal resolves against APP_BASE_URL (the public tenant-facing
 * host) via utils/env.appBaseUrl() at call time — never inlined. openPortal builds
 * an absolute `${APP_BASE_URL}/portal/:token` URL so it opens the portal host even
 * though Playwright's configured baseURL is the admin portal.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { appBaseUrl } from '../utils/env';
import { trackRequests, type RequestCounter } from '../utils/network';
import {
  VendorPortalCopy as C,
  VendorPortalLocators as L,
  PORTAL_TESTIDS as T,
  sectionKeyFor,
  type EventTypeTag,
} from '../locators/vendorPortal';

/** Values a vendor types into the response form (US-04). */
export interface ProposalInput {
  price: string;
  deliveryWeeks: string;
  /** One answer per vendor question, in question order. */
  answers: readonly string[];
}

export class VendorPortalPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /** Absolute portal URL for a token, resolved against APP_BASE_URL at call time. */
  private portalUrl(token: string): string {
    return new URL(`/portal/${token}`, appBaseUrl()).toString();
  }

  /** Open `/portal/:token` in the current (logged-out) context and wait for the shell. */
  async openPortal(token: string): Promise<void> {
    await this.page.goto(this.portalUrl(token));
  }

  /** The URL must stay on `/portal/:token` — view changes are state transitions, not navigation (§8.1). */
  async expectStillOnPortalRoute(token: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/portal/${token}(?:[/?#]|$)`));
  }

  // ── Header / shell (§8.2, AC-01.1) ──────────────────────────────────────────

  /** NO testid — the brand renders as the text "ClearEdge" inside the banner. */
  get logo(): Locator {
    return this.page.getByRole('banner').getByText(L.logoText, { exact: false }).first();
  }

  /** Theme toggle — NO testid; match its accessible name ("Toggle theme"), fall back to the switch role. */
  get themeToggle(): Locator {
    return this.page
      .getByRole('button', { name: L.themeToggleName })
      .or(this.page.getByRole(L.themeToggleFallbackRole));
  }

  async expectHeaderChrome(): Promise<void> {
    await expect(this.logo, 'ClearEdge brand visible').toBeVisible();
    await expect(this.themeToggle.first(), 'theme toggle visible').toBeVisible();
    // No navigation links, no user menu (§8.2).
    await expect(this.page.getByRole('navigation')).toHaveCount(0);
  }

  // ── Theme persistence (§8.2) ────────────────────────────────────────────────

  /** Theme persists via redux-persist under `persist:ceiq-theme` as `{ mode: "dark"|"light" }`
   * (each value JSON-stringified). Return the resolved mode string, or null if unset. */
  async readTheme(): Promise<string | null> {
    return this.page.evaluate(() => {
      try {
        const raw = window.localStorage.getItem('persist:ceiq-theme');
        if (!raw) return null;
        let mode = (JSON.parse(raw) as { mode?: unknown }).mode;
        if (typeof mode === 'string') {
          try {
            mode = JSON.parse(mode);
          } catch {
            /* already a bare string */
          }
        }
        return typeof mode === 'string' ? mode : null;
      } catch {
        return null;
      }
    });
  }

  async toggleTheme(): Promise<void> {
    await this.themeToggle.first().click();
  }

  // ── View states (§8.3) ──────────────────────────────────────────────────────

  get spinner(): Locator {
    // The product renders antd's <Skeleton data-testid={PORTAL_LOADING_SKELETON} .../> while the
    // invite is resolving, but antd's Skeleton root div forwards ONLY className/style — it drops
    // data-testid — so that testid never reaches the DOM. Anchor on the rendered antd skeleton
    // class instead (the same anchor the product's own unit test uses: `.ant-skeleton`).
    return this.page.locator('.ant-skeleton');
  }

  /** Document view landed on the resolved event (US-01 AC-01.4 / US-02). */
  async expectDocumentView(eventTitle: string): Promise<void> {
    const title = this.page.getByTestId(T.documentTitle);
    await expect(title, 'document title').toBeVisible();
    await expect(title, 'document title = event title').toContainText(eventTitle);
  }

  /** Error state — testid'd card carrying the exact warning copy (AC-01.2). */
  async expectNotFound(): Promise<void> {
    const card = this.page.getByTestId(T.invalidResult);
    await expect(card).toBeVisible();
    await expect(card).toContainText(C.notFoundTitle);
    await expect(card).toContainText(C.notFoundSubtitle);
    // Must NOT be the document view.
    await expect(this.respondCtas).toHaveCount(0);
  }

  // ── Document metadata / banners (US-02) ──────────────────────────────────────

  typeTag(type: EventTypeTag): Locator {
    // Testid'd badge, filtered to the expected tag TEXT ("RFP"/"RFQ") — asserts both
    // the element and its copy, not its geekblue/cyan colour (03-frontend no-design rule).
    // The badge appears on both the document view and the form view; when the form is open
    // the document copy stays mounted-but-hidden, so pick the VISIBLE match.
    return this.page
      .getByTestId(T.eventTypeBadge)
      .filter({ hasText: type })
      .filter({ visible: true })
      .first();
  }

  metadataValue(label: string): Locator {
    // No dedicated metadata-value testid — locate the value by its label row inside the document card.
    return this.page.getByTestId(T.documentCard).getByText(label, { exact: false });
  }

  countdownBox(): Locator {
    return this.page.getByTestId(T.countdownTimer);
  }

  async expectCountdownVisible(): Promise<void> {
    await expect(this.countdownBox(), 'countdown box').toBeVisible();
  }

  async expectOpenBanner(deadlineMMDDYYYY: string): Promise<void> {
    const banner = this.page.getByTestId(T.openAlert);
    await expect(banner, 'open-submissions banner').toBeVisible();
    await expect(banner).toContainText(C.openBanner(deadlineMMDDYYYY));
  }

  async expectClosedBanner(): Promise<void> {
    const banner = this.page.getByTestId(T.closedAlert);
    await expect(banner, 'closed banner').toBeVisible();
    await expect(banner).toContainText(C.closedBanner);
  }

  async expectNoCountdownNoOpenBanner(): Promise<void> {
    await expect(this.countdownBox()).toHaveCount(0);
    await expect(this.page.getByTestId(T.openAlert)).toHaveCount(0);
  }

  async expectContactBlock(
    type: EventTypeTag,
    issuerName: string,
    issuerEmail: string,
  ): Promise<void> {
    const card = this.page.getByTestId(T.issuerContactCard);
    await expect(card, 'issuer contact card').toBeVisible();
    await expect(
      this.page.getByTestId(T.issuerContactEmailLink),
      'mailto issuer link',
    ).toHaveAttribute('href', `mailto:${issuerEmail}`);
    await expect(card).toContainText(C.contactClosingLine(type, issuerName, issuerEmail));
  }

  /** Bottom red deadline line + (open only) helper text (AC-02.8). */
  async expectBottomDeadlineLine(deadlineMMDDYYYY: string, closed: boolean): Promise<void> {
    const line = closed
      ? C.bottomDeadlineLine(deadlineMMDDYYYY) + C.closedDeadlineSuffix
      : C.bottomDeadlineLine(deadlineMMDDYYYY);
    await expect(this.page.getByText(line, { exact: false }).first()).toBeVisible();
  }

  async expectOpenHelperText(visible: boolean): Promise<void> {
    const helper = this.page.getByText(C.bottomHelperOpen, { exact: true });
    if (visible) {
      await expect(helper).toBeVisible();
    } else {
      await expect(helper).toHaveCount(0);
    }
  }

  // ── Table of contents (AC-02.5) ──────────────────────────────────────────────

  tocEntry(sectionName: string): Locator {
    // TOC link is testid'd by section key: portal-toc-link-<sectionKey>.
    return this.page.getByTestId(T.tocLink(sectionKeyFor(sectionName)));
  }

  sectionHeading(sectionName: string): Locator {
    // Section container is testid'd by section key: portal-section-<sectionKey>.
    return this.page.getByTestId(T.section(sectionKeyFor(sectionName)));
  }

  // ── Respond CTAs (AC-02.7) ────────────────────────────────────────────────────

  /** Two distinct testids: top-right (portal-respond-button) + bottom (portal-bottom-respond-button).
   * CSS union so `.count()` reliably returns BOTH (Playwright `.or()` can under-count). */
  get respondCtas(): Locator {
    return this.page.locator(
      `[data-testid="${T.respondButton}"], [data-testid="${T.bottomRespondButton}"]`,
    );
  }

  async expectRespondCtasEnabled(): Promise<void> {
    // Retry until both CTAs have rendered (the bottom one paints slightly after the top) —
    // a raw count() snapshot is racy.
    await expect(this.respondCtas, 'two Respond CTAs (top-right + bottom)').toHaveCount(2, {
      timeout: 15_000,
    });
    const count = await this.respondCtas.count();
    for (let i = 0; i < count; i += 1) {
      await expect(this.respondCtas.nth(i)).toBeEnabled();
    }
  }

  async expectRespondCtasDisabled(): Promise<void> {
    const count = await this.respondCtas.count();
    for (let i = 0; i < count; i += 1) {
      await expect(this.respondCtas.nth(i)).toBeDisabled();
    }
  }

  // ── PDF export (US-03, §8.8) ───────────────────────────────────────────────────

  get downloadPdfButton(): Locator {
    return this.page.getByTestId(T.downloadPdfButton);
  }

  async expectDownloadButtonVisible(): Promise<void> {
    await expect(this.downloadPdfButton).toBeVisible();
  }

  /**
   * Stub window.print BEFORE navigation so the build+trigger path is scriptable
   * while the native OS dialog (not scriptable) is verified manually. Records an
   * invocation counter on window (TC-VPUI-019/021/022).
   */
  async stubPrint(): Promise<void> {
    // The app prints via window.open("","_blank") → popupWindow.print() (lib/export/printHtml.ts),
    // so stub window.open to return a fake window that records print() + captures the written HTML.
    await this.page.addInitScript(() => {
      const w = window as unknown as { __printed?: number; __printHtml?: string };
      w.__printed = 0;
      w.__printHtml = '';
      const record = (): void => {
        w.__printed = (w.__printed ?? 0) + 1;
      };
      window.print = record;
      window.open = ((): unknown => ({
        document: {
          write: (html: string): void => {
            w.__printHtml = (w.__printHtml ?? '') + String(html);
          },
          close: (): void => {},
        },
        focus: (): void => {},
        close: (): void => {},
        print: record,
      })) as typeof window.open;
    });
  }

  async printInvocationCount(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0);
  }

  async clickDownloadPdf(): Promise<void> {
    await this.downloadPdfButton.click();
  }

  /** Built printable DOM — asserted before window.print(); OS dialog is manual (TC-VPUI-019/020). */
  async printableMarkup(): Promise<string> {
    // The printable HTML is written to the (stubbed) popup via document.write — captured
    // on window.__printHtml by stubPrint(). Falls back to the live body if unset.
    return this.page.evaluate(
      () => (window as unknown as { __printHtml?: string }).__printHtml || document.body.innerHTML,
    );
  }

  // ── Response form (US-04) ──────────────────────────────────────────────────────

  /** Open the response form from the document view (state transition, not navigation). */
  async openResponseForm(): Promise<void> {
    await this.respondCtas.first().click();
  }

  get priceInput(): Locator {
    return this.page.getByTestId(T.formTotalPriceInput);
  }

  get deliveryInput(): Locator {
    return this.page.getByTestId(T.formDeliveryWeeksInput);
  }

  get answerFields(): Locator {
    // Per-question answer inputs are testid'd portal-answer-input-<questionId>; the POM
    // fills them by index, so anchor on the shared testid PREFIX rather than a single id.
    return this.page.locator(`[data-testid^="${T.answerInputPrefix}"]`);
  }

  /** Precise per-question answer input (portal-answer-input-<questionId>). */
  answerInput(questionId: string): Locator {
    return this.page.getByTestId(T.answerInput(questionId));
  }

  get fileInput(): Locator {
    // The visible control is portal-form-upload-button (see `uploadButton`); setInputFiles
    // still targets the underlying hidden <input type=file> antd's Upload renders.
    return this.page.locator('input[type="file"]');
  }

  get uploadButton(): Locator {
    return this.page.getByTestId(T.formUploadButton);
  }

  get submitButton(): Locator {
    return this.page.getByTestId(T.formSubmitButton);
  }

  /** Back control — form view = portal-form-back-button; success view = portal-success-back-button.
   *  Both live in the DOM at once (the inactive view is hidden with display:none), so `.or().first()`
   *  would pick whichever comes first — often the HIDDEN one — and hang. Scope to the VISIBLE button. */
  get backToDocument(): Locator {
    return this.page.locator(
      `[data-testid="${T.formBackButton}"]:visible, [data-testid="${T.successBackButton}"]:visible`,
    );
  }

  /** Form header card repeats type / title / deadline (AC-04.1). The card shows the
   * type as plain text ("RFP"/"RFQ"), not the document-view portal-event-type-badge. */
  async expectFormHeaderCard(
    type: EventTypeTag,
    eventTitle: string,
    deadlineMMDDYYYY: string,
  ): Promise<void> {
    const card = this.page.getByTestId(T.formHeaderCard);
    await expect(card, 'form header card').toBeVisible();
    await expect(card).toContainText(type);
    await expect(card).toContainText(eventTitle);
    await expect(card).toContainText(deadlineMMDDYYYY);
  }

  async expectFormTitle(vendorName: string): Promise<void> {
    // "Proposal Submission for {vendorName}" is a heading in the form body (not the
    // header card). Assert the heading by its accessible name.
    await expect(
      this.page.getByRole('heading', { name: C.responseFormTitle(vendorName) }),
      'response form title heading',
    ).toBeVisible();
  }

  /** Clear-before-fill (automation-architecture §2): forms may retain values across state transitions. */
  async fillProposal(input: ProposalInput): Promise<void> {
    await this.priceInput.clear();
    await this.priceInput.fill(input.price);
    await this.deliveryInput.clear();
    await this.deliveryInput.fill(input.deliveryWeeks);
    const count = await this.answerFields.count();
    for (let i = 0; i < input.answers.length && i < count; i += 1) {
      await this.answerFields.nth(i).clear();
      await this.answerFields.nth(i).fill(input.answers[i]);
    }
  }

  /** Stage a file via the hidden upload input — accepts a path or an in-memory payload. */
  async selectFile(
    file: string | { name: string; mimeType: string; buffer: Buffer },
  ): Promise<void> {
    await this.fileInput.setInputFiles(file);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async goBackToDocument(): Promise<void> {
    await this.backToDocument.first().click();
  }

  /** Exact inline field error below a field (AC-04.2/04.3, §8.9). Price/number errors have no testid → text.
   *  Price and delivery share the same "Please enter a valid number" copy, so once both are invalid the
   *  text resolves to two nodes (#totalPrice_help + #deliveryWeeks_help) — assert at least one is visible. */
  async expectFieldError(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true }).first()).toBeVisible();
  }

  /** File-upload rejection error — testid'd (portal-form-file-error) carrying the exact copy (§8.9). */
  async expectFileError(message: string): Promise<void> {
    const err = this.page.getByTestId(T.formFileError);
    await expect(err, 'file error').toBeVisible();
    await expect(err).toContainText(message);
  }

  /** EC-04.1 / §8.5 — the form-closed alert (testid'd) carrying "This sourcing event has closed". */
  async expectFormClosedBanner(): Promise<void> {
    const banner = this.page.getByTestId(T.formClosedAlert);
    await expect(banner, 'form-closed alert').toBeVisible();
    await expect(banner).toContainText(C.formClosedBanner);
  }

  /**
   * EC-06.3 — the same closed banner, but inside the WITHDRAW MODAL.
   *
   * Located by mandated copy scoped to the dialog rather than by testid, because
   * PORTAL_FORM_CLOSED_ALERT is rendered only by PortalResponseForm (see
   * lib/constants/portalTestIds.ts and PortalResponseForm.tsx) — the modal renders the same
   * Alert copy with no testid of its own. Asserting the form's testid here failed on
   * 2026-09-08 while the modal was plainly showing the banner and a disabled confirm, i.e.
   * the behaviour was right and only the locator was wrong. Scoping to role=dialog keeps
   * this from matching the page-level "This event is now closed" banner behind the modal.
   *
   * Worth a testid on that Alert if anyone touches it — it would let this use the same
   * locator as the form path.
   */
  async expectWithdrawClosedBanner(): Promise<void> {
    const dialog = this.page.getByRole('dialog');
    await expect(dialog, 'withdraw modal').toBeVisible();
    await expect(
      dialog.getByText(C.formClosedBanner, { exact: false }),
      'closed banner inside the withdraw modal',
    ).toBeVisible();
  }

  async expectFileFieldChrome(): Promise<void> {
    // Label + helper copy have no testid — asserted as text; the upload control is testid'd.
    await expect(this.page.getByText(L.proposalDocumentLabel, { exact: true })).toBeVisible();
    await expect(this.page.getByText(C.fileFieldHelper, { exact: true })).toBeVisible();
    await expect(this.uploadButton).toBeVisible();
  }

  /** Hover the ⓘ info icon for a field (NOT the input) and read its tooltip (AC-04.8).
   * The form shows exactly two info icons — price (first) then delivery (second). */
  async expectTooltip(fieldLabel: RegExp, tooltip: string): Promise<void> {
    const isDelivery = /Delivery/i.test(fieldLabel.source);
    const icons = this.page.getByRole('img', { name: /info-circle/i });
    await icons.nth(isDelivery ? 1 : 0).hover();
    await expect(this.page.getByText(tooltip, { exact: true })).toBeVisible();
  }

  async expectToast(message: string): Promise<void> {
    await expect(this.page.getByText(message, { exact: true })).toBeVisible();
  }

  /** EC-04.1 / §8.5 — every input + upload + submit disabled when the event closes. */
  async expectFormDisabled(): Promise<void> {
    await expect(this.priceInput).toBeDisabled();
    await expect(this.deliveryInput).toBeDisabled();
    await expect(this.submitButton).toBeDisabled();
    const answers = await this.answerFields.count();
    for (let i = 0; i < answers; i += 1) {
      await expect(this.answerFields.nth(i)).toBeDisabled();
    }
  }

  // ── Confirmation (US-05) ────────────────────────────────────────────────────────

  async expectConfirmation(vendorName: string): Promise<void> {
    const card = this.page.getByTestId(T.successResult);
    // The real submit does synchronous Q&A-PDF gen + S3 + email/AI enqueue before it
    // returns, so the confirmation can take well over the default 5s under load.
    await expect(card, 'confirmation success screen').toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(C.confirmationTitle(vendorName));
  }

  async expectConfirmationSubtitle(): Promise<void> {
    const card = this.page.getByTestId(T.successResult);
    await expect(card).toContainText(C.confirmationSubtitleLine1);
    await expect(card).toContainText(C.submittedOnPattern);
  }

  /** BR-05.2 — em dash where the timestamp would be when it is absent. */
  async expectMissingTimestampEmDash(): Promise<void> {
    await expect(this.page.getByTestId(T.successResult)).toContainText(
      new RegExp(`Submitted on:\\s*${C.emDash}`),
    );
  }

  // ── Submitted state + withdraw (US-06) ────────────────────────────────────────────

  get submittedControl(): Locator {
    return this.page.getByTestId(T.submittedButton);
  }

  get withdrawCaret(): Locator {
    // The dropdown trigger next to the submitted button.
    return this.page.getByTestId(T.withdrawOptionsButton);
  }

  get withdrawMenuItem(): Locator {
    return this.page.getByTestId(T.withdrawMenuItem);
  }

  async expectSubmittedControl(): Promise<void> {
    await expect(this.submittedControl, 'green "Proposal has been submitted" control').toBeVisible();
    // The submitted-state control replaces the Respond CTAs (AC-06.1 / §8.3).
    await expect(this.respondCtas).toHaveCount(0);
  }

  async openWithdrawDropdown(): Promise<void> {
    await this.withdrawCaret.click();
  }

  async openWithdrawModal(): Promise<void> {
    await this.openWithdrawDropdown();
    await this.withdrawMenuItem.click();
  }

  async expectWithdrawModal(): Promise<void> {
    // The testid is on antd's ant-modal-root wrapper (0-size, always "hidden" to Playwright);
    // assert the modal's CONTENT + action buttons instead of the wrapper's visibility.
    const confirm = this.page.getByTestId(T.withdrawModalConfirmButton);
    await expect(confirm, 'withdraw modal confirm button').toBeVisible();
    await expect(this.page.getByTestId(T.withdrawModalCancelButton)).toBeVisible();
    const dialog = this.page.getByRole('dialog').filter({ hasText: L.withdrawModalTitle });
    await expect(dialog, 'withdraw modal dialog + copy').toContainText(C.withdrawModalBody);
  }

  async confirmWithdraw(): Promise<void> {
    await this.page.getByTestId(T.withdrawModalConfirmButton).click();
  }

  async cancelWithdraw(): Promise<void> {
    await this.page.getByTestId(T.withdrawModalCancelButton).click();
  }

  async expectWithdrawDisabled(): Promise<void> {
    // AC-06.6 / §8.5 / §8.6 — dropdown trigger unavailable (read-only) when closed or awarded.
    await expect(this.withdrawCaret).toBeDisabled();
  }

  async expectWithdrawConfirmDisabled(): Promise<void> {
    await expect(this.page.getByTestId(T.withdrawModalConfirmButton)).toBeDisabled();
  }

  // ── Generic spec-pinned assertions ────────────────────────────────────────────────

  /** Assert a spec-pinned copy/data string is visible (first match — deadline/title recur). */
  async expectVisible(text: string): Promise<void> {
    await expect(this.page.getByText(text, { exact: false }).first()).toBeVisible();
  }

  /** ASM-07 budget non-disclosure — the budget value must never appear anywhere. */
  async expectBudgetAbsent(budgetValue: string): Promise<void> {
    await expect(this.page.getByText(budgetValue, { exact: false })).toHaveCount(0);
  }

  async expectClosedBannerAbsent(): Promise<void> {
    await expect(this.page.getByTestId(T.closedAlert)).toHaveCount(0);
  }

  // ── Sections / ToC (AC-02.5 / AC-02.6 / §8.7) ───────────────────────────────────────

  async clickTocEntry(sectionName: string): Promise<void> {
    await this.tocEntry(sectionName).click();
  }

  async expectSectionInViewport(sectionName: string): Promise<void> {
    await expect(this.sectionHeading(sectionName)).toBeInViewport();
  }

  /** AC-02.6 — visible section auto-numbered by display position (e.g. "1. Scope of Work"). */
  async expectSectionNumbered(sectionName: string, position: number): Promise<void> {
    const section = this.page.getByTestId(T.section(sectionKeyFor(sectionName)));
    await expect(section, `section "${sectionName}" visible`).toBeVisible();
    // Auto-numbering + name are still asserted as copy, scoped to the testid'd section.
    await expect(section).toContainText(new RegExp(`${position}\\.\\s*${sectionName}`));
  }

  /** An empty catalog section is hidden entirely (BR-02.1). */
  async expectSectionHidden(sectionName: string): Promise<void> {
    await expect(this.page.getByTestId(T.section(sectionKeyFor(sectionName)))).toHaveCount(0);
  }

  // ── File staging (US-04 §8.9) ────────────────────────────────────────────────────────

  stagedFile(fileName: string): Locator {
    return this.page.getByText(fileName, { exact: false });
  }

  async expectStagedFile(fileName: string): Promise<void> {
    await expect(this.stagedFile(fileName)).toBeVisible();
  }

  async expectNoStagedFile(fileName: string): Promise<void> {
    await expect(this.stagedFile(fileName)).toHaveCount(0);
  }

  async removeStagedFile(): Promise<void> {
    // contract TBD: the remove control sits next to the staged filename.
    await this.page.getByRole('button', { name: /remove|delete/i }).first().click();
  }

  // ── Currency (ASM-05 / BR-04.3) ────────────────────────────────────────────────────────

  /**
   * The price control itself is denominated in USD (AC-04.2).
   *
   * Scoped to the form card on purpose. A page-wide `getByText('USD').first()` matched a
   * HIDDEN paragraph of the sourcing document's own body copy on an event whose terms
   * happen to mention USD, and failed on "hidden" while the real label was on screen.
   */
  async expectPriceDenominatedInUsd(): Promise<void> {
    await expect(this.page.getByTestId(T.formCard).getByText('USD').first()).toBeVisible();
  }

  /** No currency selector/dropdown/radio anywhere on the form — USD is fixed (TC-VPUI-052). */
  async expectNoCurrencySelector(): Promise<void> {
    await expect(this.page.getByRole('combobox', { name: /currency/i })).toHaveCount(0);
    await expect(this.page.getByRole('radio', { name: /USD|EUR|GBP|currency/i })).toHaveCount(0);
  }

  // ── Network trackers (assert call counts without hitting the app on skip) ──────────

  /** Count invitation-resolve GETs (AC-01.3 fail-fast; path contract TBD → filter on /portal/). */
  trackInvitationFetches(): RequestCounter {
    // Count only the XHR/fetch API resolve — NOT the page-document navigation GET
    // (also a /portal/ URL) or static assets, which would over-count.
    return trackRequests(
      this.page,
      (r) =>
        r.method() === 'GET' &&
        r.url().toLowerCase().includes('/portal/') &&
        (r.resourceType() === 'xhr' || r.resourceType() === 'fetch'),
    );
  }

  /** Count withdraw DELETEs (AC-06.4 / §8.10 → DELETE /api/portal/:token/submit). */
  trackWithdrawRequests(): RequestCounter {
    return trackRequests(
      this.page,
      (r) => r.method() === 'DELETE' && r.url().toLowerCase().includes('/portal/'),
    );
  }
}
