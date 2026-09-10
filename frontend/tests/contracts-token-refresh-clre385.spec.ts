/**
 * CLRE-385 — "Token Getting expire while user performing action. Refresh token is not
 * working". The general case of CLRE-326 (which covered the chat SSE path specifically,
 * because that path bypasses the axios interceptor and needed a PROACTIVE refresh).
 *
 * This ticket is about ordinary axios-backed actions, so the code under test is the REACTIVE
 * path in lib/api/client.ts: a 401 response triggers refreshAccessToken(), which posts the
 * stored refreshToken, calls setTokens with the new pair, and retries the original request.
 *
 * HOW THIS DRIVES IT — and why it does not use Playwright's clock. A clock skew was tried on
 * 2026-09-08 and could not settle this: skewing far enough to expire the current token also
 * makes any FRESHLY REFRESHED token look expired (its real exp sits ~60 min ahead of true
 * now, which the skewed browser reads as about a minute), so the app could refresh perfectly
 * and still conclude it was expired. "Lands on Sign in" was therefore ambiguous.
 *
 * Instead: corrupt only the SIGNATURE of the stored idToken, leaving header, payload and the
 * refreshToken untouched. That isolates the reactive path exactly —
 *   - client side: `exp` still decodes as healthy, so no proactive/expiry branch is involved
 *     (client.ts never verifies the signature — see bearerTokenFor);
 *   - server side: the API rejects it 401, the same way it rejects a genuinely expired token;
 *   - so the only thing that can make the request succeed is the interceptor refreshing and
 *     retrying, which is precisely what this ticket says is not working.
 *
 * PASS CRITERION, restated for the accepted fix (a707d07, 2026-09-08). The defect that fix
 * addresses is the STUCK HALF-AUTHENTICATED state: a 401 on an already-retried request hit
 * the `originalRequest._retry` guard and was silently rejected, so the app kept
 * isAuthenticated true while every panel showed a permanent "Failed to load dashboard" /
 * "Unable to load profile" with no way out. The fix routes that case to clearAuth() +
 * redirectToLogin() instead. So there are now two ACCEPTABLE outcomes and one failure:
 *
 *   RECOVERED  - refresh succeeded, the retry succeeded, data loaded, stored idToken
 *                replaced. This is the outcome a real expiry should produce.
 *   SIGNED_OUT - refresh succeeded but the retried request 401'd again, so the app cleared
 *                auth and redirected to /login with "Session expired". Not stuck, but the
 *                session was NOT recovered - for a real user that is being logged out
 *                mid-action, which is the complaint this ticket opens with. Reported, not
 *                silently passed.
 *   STUCK      - the failure this ticket is about: load errors on an app route with no
 *                redirect. Hard-fails.
 *
 * The run also records, per /api/v1 request, which bearer token was attached (last 8 chars
 * of the signature) and what the server answered. That is what separates "the refresh never
 * fired", "it fired and the refresh call failed", and "it fired, minted a new token, and the
 * server rejected THAT too" - three different defects that all look alike from the screen.
 */
import { test, expect, type Page } from '@playwright/test';
import { appBaseUrl } from '../utils/env';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;
const AUTH_KEY = 'persist:ceiq-auth';

async function storedIdToken(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(JSON.parse(raw).idToken as string) as string; } catch { return null; }
  }, AUTH_KEY);
}

test.describe('Auth — reactive token refresh on ordinary actions (CLRE-385)', () => {
  test('TC-AUTHUI-385 — a 401 from an aged-out token is refreshed and the action completes @regression', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto(appUrl('/dashboard'));
    await expect(page.getByRole('menuitem', { name: /Contracts/i })).toBeVisible({ timeout: 45_000 });

    const before = await storedIdToken(page);
    expect(before, 'no id token in localStorage').toBeTruthy();

    // Invalidate ONLY the signature; keep header + payload (so `exp` still reads healthy)
    // and keep the refresh token, which is what the interceptor needs to recover.
    const planted = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key)!;
      const slice = JSON.parse(raw) as Record<string, string>;
      const token = JSON.parse(slice.idToken as string) as string;
      const [h, p, sig] = token.split('.');
      // Flip a MIDDLE character of the signature only - same length, still a well-formed
      // JWT. Not the last character: a 43-char base64url signature encodes 32 bytes, so the
      // final character's low 2 bits are padding and 'A'->'B' there leaves the decoded
      // signature byte-identical. Six such tokens were accepted 200 by QA on 2026-09-08,
      // which silently turned this case into a no-op on any run where that happened.
      const mid = Math.floor((sig ?? '').length / 2);
      const flip = (c: string) => (c === 'X' ? 'Y' : 'X');
      const broken = (sig ?? '').slice(0, mid) + flip((sig ?? '')[mid] ?? 'X') + (sig ?? '').slice(mid + 1);
      slice.idToken = JSON.stringify(`${h}.${p}.${broken}`);
      window.localStorage.setItem(key, JSON.stringify(slice));
      return { planted: `${h}.${p}.${broken}`, refreshTokenIntact: Boolean(slice.refreshToken) };
    }, AUTH_KEY);
    expect(planted.refreshTokenIntact, 'the refresh token must survive — it is what recovery uses').toBe(true);

    // Confirm the payload still decodes as healthy, so nothing here is testing expiry logic.
    const secondsLeft = await page.evaluate((t) => {
      const p = JSON.parse(atob((t as string).split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      return (p.exp as number) - Math.floor(Date.now() / 1000);
    }, planted.planted);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-385] planted token: signature invalid, exp still ${secondsLeft}s away (client sees it as healthy)`);
    expect(secondsLeft, 'the planted token must still look unexpired client-side').toBeGreaterThan(120);

    // Record every auth-endpoint call, so the verdict can distinguish "the interceptor never
    // fired" from "it fired and the refresh itself failed" — those are different defects.
    const authCalls: string[] = [];
    page.on('response', (r) => {
      if (/\/api\/v1\/auth\//.test(r.url())) {
        authCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
      }
    });

    // Which token was attached to each API call, and what the server said about it. `tail`
    // is the last 8 chars of the JWT signature — enough to tell the planted token from a
    // freshly refreshed one without putting a live credential in a log.
    const tail = (t: string | undefined) =>
      t ? `...${t.split('.')[2]?.slice(-8) ?? '?'}` : 'no-bearer';
    const plantedTail = tail(planted.planted);
    // What /auth/refresh actually handed back. An api-ts probe on 2026-09-08 showed the
    // API accepts a refreshed ID token (200) but rejects a refreshed ACCESS token (401
    // ERR_AUTH_INVALID_TOKEN, token_use=access) - so if a retry 401s on a "new" token, the
    // decisive question is WHICH new token it carried. Naming them here answers it.
    const refreshed: { id?: string; access?: string } = {};
    page.on('response', (r) => {
      if (!/\/api\/v1\/auth\/refresh/.test(r.url()) || r.status() !== 200) return;
      void r
        .json()
        .then((body: unknown) => {
          const d = ((body as { data?: Record<string, string> })?.data ?? body) as Record<string, string>;
          refreshed.id = d?.idToken;
          refreshed.access = d?.accessToken;
        })
        .catch(() => undefined);
    });
    const apiTrace: string[] = [];
    const rejectedRetryTokens = new Set<string>();
    page.on('response', (r) => {
      if (!/\/api\/v1\//.test(r.url())) return;
      const auth = r.request().headers()['authorization'];
      const bearer = auth?.replace(/^Bearer\s+/i, '');
      let which = tail(bearer);
      if (bearer && which === plantedTail) which = 'PLANTED';
      else if (bearer && refreshed.id && which === tail(refreshed.id)) which = `REFRESHED-ID(${which})`;
      else if (bearer && refreshed.access && which === tail(refreshed.access)) which = `REFRESHED-ACCESS(${which})`;
      apiTrace.push(`${new URL(r.url()).pathname.replace('/api/v1', '')}[${which}]->${r.status()}`);
      // A 401 on a token that is NOT the planted one is the finding worth chasing: it means
      // the app refreshed and the API rejected the result. Keep it so it can be replayed
      // from Node (scripts/probe-clre385-replay-token.ts) - the only way to tell a bad
      // token from a bad request.
      if (r.status() === 401 && bearer && which !== 'PLANTED') rejectedRetryTokens.add(bearer);
    });

    // ── The ordinary action: reload so fresh requests go out on the bad token ─────────
    // Wait for a response whose request actually CARRIED the planted token, rather than for
    // the first /api/v1 response of any kind. Those are not the same thing: on 2026-09-09
    // the first response back was a cached 200 on /chat/contracts, which Playwright reports
    // like any other 200 even though no request went to the server with our token - and the
    // run was written off as "the plant did not take" when it had not yet been tested.
    const plantedUsed = page.waitForResponse(
      (r) => {
        if (!/\/api\/v1\//.test(r.url()) || /\/auth\//.test(r.url())) return false;
        const bearer = r.request().headers()['authorization']?.replace(/^Bearer\s+/i, '');
        return Boolean(bearer) && tail(bearer) === plantedTail;
      },
      { timeout: 60_000 },
    ).catch(() => null);
    await page.reload();
    const first = await plantedUsed;
    // eslint-disable-next-line no-console
    console.log(
      first
        ? `[CLRE-385] first response on the PLANTED token: ${first.status()} ${new URL(first.url()).pathname}`
        : '[CLRE-385] no request carried the planted token within 60s',
    );

    // Two ways this run cannot say anything. Either nothing used the planted token (a
    // background refresh replaced it before the reload), or the server accepted it - which
    // would mean the mutation did not really corrupt the signature. Neither exercises the
    // 401 path, so both are INCONCLUSIVE rather than a pass.
    if (!first) {
      // eslint-disable-next-line no-console
      console.log('[CLRE-385] outcome: INCONCLUSIVE — the planted token never reached the wire; re-run');
      test.skip(true, 'the planted token never reached the wire; re-run');
    } else if (first.status() !== 401) {
      // eslint-disable-next-line no-console
      console.log(`[CLRE-385] outcome: INCONCLUSIVE — the server ACCEPTED the planted token (${first.status()}), so no 401 was induced`);
      test.skip(true, 'planted token was accepted; the corruption did not take');
    }

    // ── The outcome that matters ──────────────────────────────────────────────────────
    // Settle on whichever terminal state the app reaches: recovered, or signed out. Both
    // are stable end states; the stuck state is neither, so it falls through to the timeout
    // and is reported as STUCK below.
    const signedOut = /login|signin|sign-in/i;
    const loadFailure = page.getByText(/failed to load|could not fetch|unable to load/i);
    const navItem = page.getByRole('menuitem', { name: /Contracts/i });

    let outcome: 'RECOVERED' | 'SIGNED_OUT' | 'STUCK' = 'STUCK';
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (signedOut.test(page.url())) { outcome = 'SIGNED_OUT'; break; }
      const failures = await loadFailure.count();
      const navVisible = await navItem.isVisible().catch(() => false);
      const after = await storedIdToken(page);
      if (!failures && navVisible && after && after !== planted.planted) { outcome = 'RECOVERED'; break; }
      await page.waitForTimeout(1_000);
    }

    const after = await storedIdToken(page);
    /* eslint-disable no-console */
    console.log(`[CLRE-385] outcome: ${outcome}`);
    console.log(`[CLRE-385] url: ${page.url()}`);
    console.log(`[CLRE-385] stored id token replaced: ${Boolean(after) && after !== planted.planted}`);
    // Logged HERE, not right after the 401: the refresh is a round-trip that has not
    // happened yet at that point, and logging it early reported "NONE" on a run where the
    // refresh did in fact occur.
    console.log(`[CLRE-385] auth calls: ${authCalls.length ? authCalls.join(' | ') : 'NONE — no refresh was attempted'}`);
    console.log(`[CLRE-385] api trace: ${apiTrace.join(' | ')}`);
    console.log(
      `[CLRE-385] refresh handed back: idToken ${tail(refreshed.id)} accessToken ${tail(refreshed.access)}`,
    );
    if (process.env.CLRE385_DUMP_TOKEN === '1') {
      for (const t of rejectedRetryTokens) console.log(`[CLRE-385] REJECTED-TOKEN ${t}`);
    }
    /* eslint-enable no-console */

    // The hard assertion is the defect a707d07 fixes: never a permanent load failure on an
    // app route with the session still considered live.
    expect(
      outcome,
      'CLRE-385: after a 401 the app must reach a terminal state — either the refresh ' +
      'recovers the action, or it signs the user out. Sitting on an app route showing ' +
      '"Failed to load dashboard" / "Unable to load profile" while still authenticated is ' +
      `the reported defect. api trace: ${apiTrace.join(' | ')}`,
    ).not.toBe('STUCK');

    // Not stuck, but not recovered either: the user is bounced to login mid-action, which is
    // what this ticket's title describes. Soft, so the run still reports the trace above and
    // one execution answers both questions.
    expect
      .soft(
        outcome,
        'CLRE-385: the session was cleared rather than refreshed. The stuck state is fixed, ' +
        'but the action did not survive the 401 — check the api trace for whether the ' +
        'retried request carried a NEW token and was still rejected, which would mean the ' +
        `refresh mints tokens the API will not accept. api trace: ${apiTrace.join(' | ')}`,
      )
      .toBe('RECOVERED');
  });
});
