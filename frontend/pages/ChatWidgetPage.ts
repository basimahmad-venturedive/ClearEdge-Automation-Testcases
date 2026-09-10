/**
 * CEIQ-FEAT-010 Contract Q&A Chat — page object for the floating widget.
 *
 * The widget is mounted once in the app shell, so this object is route-agnostic: it is
 * constructed against whatever page is loaded and asked about the widget's state there.
 *
 * Sending a message costs a real Bedrock round-trip (2–6 s on QA, occasionally longer
 * behind the worker queue), so `send()` waits on the streaming lifecycle rather than a
 * fixed timeout, and specs share a completed exchange wherever the assertions allow.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  ChatTestIds as T, CITATION_CHIP_PREFIX, MESSAGE_BUBBLE_PREFIX,
  SCOPE_CONTRACT_OPTION_PREFIX, scopeContractOption,
} from '../locators/chat';
import { ChatCopy } from '../tests/fixtures/expectedCopyChat';
import { appBaseUrl } from '../utils/env';

export class ChatWidgetPage {
  constructor(private readonly page: Page) {}

  // ---------------------------------------------------------------- navigation
  /**
   * Navigate and settle.
   *
   * The widget mounts in the app shell only after hydration, and on QA that takes
   * anywhere from ~1 s to ~12 s depending on how the backing API calls behave. A fixed
   * wait therefore produces a false "widget missing" on slow loads — which is exactly
   * how an early version of this object failed TC-CHATUI-002 while TC-CHATUI-007
   * passed on the same route. So:
   *
   *   expectWidget: true   poll for the launcher, up to `settleMs`
   *   expectWidget: false  wait a fixed settle window, then let the caller assert
   *                        absence — polling for something that must never appear
   *                        would just burn the whole timeout
   */
  async goto(route: string, expectWidget = false, settleMs = 25_000): Promise<void> {
    await this.page.goto(`${appBaseUrl()}${route}`, { waitUntil: 'domcontentloaded' });
    if (!expectWidget) {
      await this.page.waitForTimeout(4000);
      return;
    }
    await expect
      .poll(async () => this.isLauncherVisible(), { timeout: settleMs, intervals: [400] })
      .toBe(true);
  }

  // ------------------------------------------------------------------ locators
  pill(): Locator { return this.page.getByTestId(T.launcherPill); }
  launcherButton(): Locator { return this.page.getByTestId(T.launcherButton); }
  panel(): Locator { return this.page.getByTestId(T.panelCard); }
  minimise(): Locator { return this.page.getByTestId(T.minimise); }
  maximise(): Locator { return this.page.getByTestId(T.maximise); }
  closeButton(): Locator { return this.page.getByTestId(T.close); }
  closeConfirmOk(): Locator { return this.page.getByTestId(T.closeConfirmOk); }
  closeConfirmCancel(): Locator { return this.page.getByTestId(T.closeConfirmCancel); }
  messages(): Locator { return this.page.getByTestId(T.messagesContainer); }
  thinking(): Locator { return this.page.getByTestId(T.thinking); }
  cursor(): Locator { return this.page.getByTestId(T.streamingCursor); }
  scopeToggle(): Locator { return this.page.getByTestId(T.scopeToggle); }
  clearThread(): Locator { return this.page.getByTestId(T.clearThread); }
  input(): Locator { return this.page.getByTestId(T.input); }
  sendButton(): Locator { return this.page.getByTestId(T.send); }
  picker(): Locator { return this.page.getByTestId(T.scopePicker); }
  /** CLRE-320 — the picker's minimize control. No testid, so located by its aria-label. */
  pickerMinimise(): Locator { return this.page.getByRole('button', { name: ChatCopy.pickerMinimiseLabel }); }
  scopeSearch(): Locator { return this.page.getByTestId(T.scopeSearch); }
  scopeGeneral(): Locator { return this.page.getByTestId(T.scopeGeneral); }
  seeExamples(): Locator { return this.page.getByTestId(T.seeExamples); }

  bubbles(): Locator { return this.page.locator(MESSAGE_BUBBLE_PREFIX); }
  citationChips(): Locator { return this.page.locator(CITATION_CHIP_PREFIX); }
  contractOptions(): Locator { return this.page.locator(SCOPE_CONTRACT_OPTION_PREFIX); }
  contractOption(familyId: string): Locator { return this.page.getByTestId(scopeContractOption(familyId)); }

  /** No testid — the panel body text, used for copy assertions on unlabelled elements. */
  panelText(): Locator { return this.panel(); }
  exampleCard(text: string): Locator { return this.panel().getByText(text, { exact: false }); }

  // -------------------------------------------------------------------- state
  async isLauncherVisible(): Promise<boolean> {
    return (await this.pill().count()) > 0 || (await this.launcherButton().count()) > 0;
  }

  /** AC-1 asserts the widget is not rendered at all — count 0, not merely hidden. */
  async widgetElementCount(): Promise<number> {
    return (await this.pill().count()) + (await this.launcherButton().count()) + (await this.panel().count());
  }

  async isPanelOpen(): Promise<boolean> {
    return (await this.panel().count()) > 0 && (await this.panel().first().isVisible());
  }

  async open(): Promise<void> {
    if (await this.isPanelOpen()) return;
    const pill = this.pill();
    if (await pill.count()) await pill.first().click();
    else await this.launcherButton().first().click();
    await expect(this.panel().first()).toBeVisible({ timeout: 20_000 });
  }

  /**
   * Open the scope picker and wait for its CONTRACTS list to arrive.
   *
   * The picker renders immediately with an EMPTY contracts section and fills in when
   * `GET /chat/contracts` resolves — measured on QA at anywhere from instant to several
   * seconds. Without this poll, `contractOptions().nth(0).click()` waits on an element
   * that does not exist yet and burns the whole test timeout. That single omission
   * caused six cascading timeouts in the first UI run.
   */
  async openPicker(waitForRows = true): Promise<void> {
    await this.scopeToggle().first().click();
    await expect(this.picker().first()).toBeVisible({ timeout: 15_000 });
    if (waitForRows) {
      await expect
        .poll(async () => this.contractOptions().count(), { timeout: 25_000, intervals: [300] })
        .toBeGreaterThan(0);
    }
  }

  /**
   * Dismiss the picker by selecting General scope.
   *
   * HISTORY: this used to be the ONLY way out — Escape did not close the picker and the
   * scope pill was unmounted while it was open (BUG-CHAT-010 / CLRE-362). Both were
   * fixed and verified on QA 2026-09-02, and CLRE-320 added a minimize control as a
   * third path, so the picker can now be dismissed without touching the scope.
   *
   * Kept as-is deliberately: this helper CHANGES the active scope to General, and
   * callers have been written around that side effect. Switching it to Escape is a
   * behaviour change for every caller, so it needs its own pass with the full UI suite
   * re-run rather than an in-passing edit. Use `pickerMinimise()` or Escape directly in
   * new cases that must not disturb the scope.
   */
  async dismissPicker(): Promise<void> {
    if ((await this.picker().count()) === 0) return;
    await this.scopeGeneral().first().click();
    await expect(this.picker()).toHaveCount(0, { timeout: 15_000 });
  }

  async selectGeneralScope(): Promise<void> {
    await this.openPicker();
    await this.scopeGeneral().first().click();
    await expect(this.picker()).toHaveCount(0, { timeout: 15_000 });
  }

  /** Select the Nth contract row in the picker; returns its visible label (monogram stripped). */
  async selectContractByIndex(index: number): Promise<string> {
    await this.openPicker();
    const row = this.contractOptions().nth(index);
    await expect(row).toBeVisible({ timeout: 15_000 });
    const label = (await row.innerText()).replace(/\s+/g, ' ').trim();
    await row.click();
    await expect(this.picker()).toHaveCount(0, { timeout: 15_000 });
    return label;
  }

  /**
   * Family ids from the picker's contract rows. Opens the picker if it is closed —
   * the rows exist only while it is open, so an earlier version that assumed an
   * already-open picker silently returned [] and made TC-CHATUI-007 pass vacuously.
   */
  async familyIdsInPicker(): Promise<string[]> {
    const opened = (await this.picker().count()) === 0;
    if (opened) await this.openPicker();
    const ids: string[] = [];
    for (const h of await this.contractOptions().all()) {
      const id = (await h.getAttribute('data-testid')) ?? '';
      ids.push(id.replace('chat-scope-contract-option-', ''));
    }
    if (opened) await this.dismissPicker();
    return ids;
  }

  /** The contract name from a picker row label, with the leading monogram removed. */
  static nameFromLabel(label: string): string {
    const parts = label.replace(/\s+/g, ' ').trim().split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : parts.join(' ');
  }

  /** The close-confirmation dialog renders in a PORTAL, outside chat-panel-card. */
  confirmDialog(): Locator {
    return this.page.locator('[role="dialog"], [role="alertdialog"]').filter({ hasText: 'Are you sure' }).first();
  }

  // ------------------------------------------------------------------ actions
  /**
   * Type and send, then wait for the stream to finish. Returns the assistant's
   * rendered text. Waits on the lifecycle (thinking/cursor disappearing and the
   * bubble count settling) rather than a fixed sleep.
   */
  async send(message: string, timeoutMs = 120_000): Promise<string> {
    const before = await this.bubbles().count();
    await this.input().first().fill(message);
    await this.sendButton().first().click();
    return this.waitForReply(before, timeoutMs);
  }

  /** Click an example card, which sends immediately (AC-6/AC-7). */
  async clickExample(text: string, timeoutMs = 120_000): Promise<string> {
    const before = await this.bubbles().count();
    await this.exampleCard(text).first().click();
    return this.waitForReply(before, timeoutMs);
  }

  private async waitForReply(bubblesBefore: number, timeoutMs: number): Promise<string> {
    // user bubble + assistant bubble = +2 once the reply lands
    await expect
      .poll(async () => this.bubbles().count(), { timeout: timeoutMs, intervals: [500] })
      .toBeGreaterThanOrEqual(bubblesBefore + 2);
    // streaming finished: cursor gone and the input re-enabled (AC-11)
    await expect.poll(async () => this.cursor().count(), { timeout: timeoutMs, intervals: [500] }).toBe(0);
    await expect(this.input().first()).toBeEnabled({ timeout: 30_000 });
    return (await this.bubbles().last().innerText()).trim();
  }

  /** Settle after a layout toggle (maximize/restore animates). */
  async page_waitFullscreen(): Promise<void> {
    await this.page.waitForTimeout(1200);
  }

  /** Short settle, used to land inside a still-streaming window. */
  async page_waitShort(): Promise<void> {
    await this.page.waitForTimeout(900);
  }

  /** data-testid of the currently focused element, for AC-11's refocus assertion. */
  async page_activeTestId(): Promise<string | null> {
    return this.page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
  }

  async clear(): Promise<void> {
    await this.clearThread().first().click();
    await expect.poll(async () => this.bubbles().count(), { timeout: 20_000 }).toBe(0);
  }

  async closeWithConfirm(): Promise<void> {
    await this.closeButton().first().click();
    await expect(this.closeConfirmOk().first()).toBeVisible({ timeout: 15_000 });
    await this.closeConfirmOk().first().click();
    await expect(this.panel()).toHaveCount(0, { timeout: 20_000 });
  }

  // ------------------------------------------------------------- assertions
  async expectLandedWithWidget(route: string): Promise<void> {
    await this.goto(route, true);
    expect(await this.isLauncherVisible(), `widget launcher should render on ${route}`).toBe(true);
  }

  async expectEmptyGeneralState(): Promise<void> {
    await expect(this.panelText()).toContainText(ChatCopy.emptyGeneralHeadline);
    await expect(this.panelText()).toContainText(ChatCopy.emptyGeneralSubtitle);
  }
}
