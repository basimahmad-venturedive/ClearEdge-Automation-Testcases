/**
 * CLRE-326 — "Token getting expire while PO having chat with chatbot".
 *
 * Fix under test: eedaded / PR #146. `lib/ai/contractChatStream.ts` opens the chat SSE with a
 * raw fetch(), which deliberately bypasses the axios 401→refresh→retry interceptor (SSE can't
 * be represented over axios — decisions.md#D-063), so an idle chat session's id token never
 * self-healed and the next send hit a hard preflight 401. The fix decodes the stored token's
 * `exp` and, when it is within TOKEN_EXPIRY_BUFFER_SECONDS (60) of expiring, calls the shared
 * `refreshAccessToken()` BEFORE opening the stream.
 *
 * HOW THIS DRIVES IT: Playwright's clock API ages the browser's clock ~59 minutes while the
 * panel sits idle, so the REAL, validly-signed token falls inside the 60-second buffer. That
 * is the ticket's scenario — a session left open until the token is about to expire — without
 * touching the token itself.
 *
 * A previous attempt (2026-09-06) planted a token with a rewritten `exp` instead. That does
 * not work, and the reason is worth keeping: rewriting the payload also invalidates the
 * SIGNATURE, which is a different condition from a validly-signed token that has merely aged
 * out. The app rejected it everywhere at once ("Unable to load profile", "Failed to load
 * dashboard") and the chat path was never reached. Moving the clock leaves the token intact.
 */
import { test, expect, type Page } from '@playwright/test';
import { appBaseUrl } from '../utils/env';
import { ChatTestIds, MESSAGE_BUBBLE_PREFIX } from '../locators/chat';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;
const AUTH_KEY = 'persist:ceiq-auth';

/** The stored id token, as the app holds it. */
async function storedIdToken(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(JSON.parse(raw).idToken as string) as string; } catch { return null; }
  }, AUTH_KEY);
}

test.describe('Chat — proactive token refresh (CLRE-326)', () => {
  test('TC-CHATUI-326 — a token that ages out mid-session is refreshed before the stream opens @regression', async ({ page }) => {
    // Must be installed before the page loads; applies to the whole context.
    await page.clock.install();

    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });

    const before = await storedIdToken(page);
    expect(before, 'no id token in localStorage').toBeTruthy();
    const expBefore = await page.evaluate((t) => {
      const p = JSON.parse(atob((t as string).split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      return p.exp as number;
    }, before);

    // Open the chat panel, then let the session sit until the token is nearly expired —
    // precisely the ticket's scenario: no navigation, no other API call in between.
    const pill = page.getByTestId('chat-launcher-pill');
    const button = page.getByTestId('chat-launcher-button');
    await expect
      .poll(async () => (await pill.count()) + (await button.count()), { timeout: 60_000, intervals: [500] })
      .toBeGreaterThan(0);
    if (await pill.count()) await pill.first().click();
    else await button.first().click();
    await expect(page.getByTestId(ChatTestIds.panelCard).first()).toBeVisible({ timeout: 30_000 });

    // setFixedTime, NOT fastForward: fastForward replays every timer in the skipped window,
    // which stampeded the app's session handling and logged the user out before a send was
    // possible (observed 2026-09-07 — the run ended on the Sign in page). isExpiringSoon()
    // reads Date.now(), so moving only the clock's reported time exercises the same branch
    // without running 59 minutes of intervals.
    const skewTo = await page.evaluate(() => Date.now() + 59 * 60 * 1000);
    await page.clock.setFixedTime(new Date(skewTo));
    const nowAfterSkip = await page.evaluate(() => Math.floor(Date.now() / 1000));
    // eslint-disable-next-line no-console
    console.log(`[CLRE-326] tokenExp=${expBefore} browserNow=${nowAfterSkip} secondsToExpiry=${expBefore - nowAfterSkip} (fix refreshes at <= 60)`);
    expect(
      expBefore - nowAfterSkip,
      'the clock skip must put the token inside the 60 s refresh buffer, or this case proves nothing',
    ).toBeLessThanOrEqual(60);

    // ── Send a message with the token on the edge of expiry ───────────────────────────
    const input = page.getByTestId(ChatTestIds.input);
    await expect(input).toBeVisible({ timeout: 30_000 });
    await input.fill('How many contracts are expiring in the next 30 days?');
    await page.getByTestId(ChatTestIds.send).click();

    await expect
      .poll(async () => page.locator(MESSAGE_BUBBLE_PREFIX).count(), { timeout: 120_000, intervals: [1000] })
      .toBeGreaterThan(1); // the user's own message plus at least one assistant bubble

    const transcript = (await page.getByTestId(ChatTestIds.messagesContainer).innerText()).toLowerCase();
    expect(
      /something went wrong|session (has )?expired|please log ?in|unauthor/i.test(transcript),
      `the send failed with a nearly-expired token — the proactive refresh did not happen. ` +
      `Transcript: "${transcript.slice(0, 300)}"`,
    ).toBe(false);

    // The direct evidence that the refresh ran: the stored token is a new one.
    const after = await storedIdToken(page);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-326] stored id token replaced: ${after !== before}`);
    expect(
      after,
      'the id token was never refreshed — it is still the one that was about to expire, so the ' +
      'stream opened on a stale token and CLRE-326 is not fixed',
    ).not.toBe(before);
  });
});
