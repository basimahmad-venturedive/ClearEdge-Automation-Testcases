/**
 * CLRE-335 — the portal's browser→S3 PUT of a proposal document was aborted
 * (net::ERR_ABORTED), so a submission with an attachment could not complete. The developer
 * diagnosed it as the S3 bucket's CORS policy not permitting the request from the portal
 * origin, and closed it as an infra dependency rather than application code.
 *
 * The end-to-end case (TC-VPUI-036: presign → PUT → submit → confirmation) still cannot run,
 * because the portal suite is gated on tests/fixtures/portal-fixture.json and there is no
 * seedable invitation token on QA (CLRE-334). But the ticket's actual symptom is testable
 * without one: a browser aborts a cross-origin PUT exactly when the CORS preflight does not
 * permit it, so issuing that PUT FROM the portal origin distinguishes the two outcomes.
 *
 *   CORS still broken → fetch REJECTS ("Failed to fetch"), no HTTP status ever arrives.
 *                       This is what surfaces in DevTools as net::ERR_ABORTED.
 *   CORS fixed        → fetch RESOLVES with an HTTP status from S3. A 403 is expected and
 *                       is a PASS here: the request is unsigned, so S3 rejects it on
 *                       authorisation — which it can only do after allowing it through CORS.
 *
 * The distinction being asserted is "the browser let the request reach S3", not "the upload
 * succeeded" — the latter needs a presigned URL and therefore a portal token.
 */
import { test, expect } from '@playwright/test';
import { appBaseUrl } from '../utils/env';

const appUrl = (p: string) => `${appBaseUrl().replace(/\/$/, '')}${p}`;
const BUCKET_HOST = 'clearedge-ai-data-source-qa.s3.us-east-1.amazonaws.com';

test.describe('Vendor portal — browser→S3 upload is not blocked by CORS (CLRE-335)', () => {
  test('TC-VPUI-036-CORS — a PUT from the portal origin reaches S3 instead of being aborted @regression', async ({ page }) => {
    // The origin matters, not the page: the preflight is evaluated against it.
    await page.goto(appUrl('/dashboard'));
    const origin = await page.evaluate(() => window.location.origin);
    // eslint-disable-next-line no-console
    console.log(`[CLRE-335] issuing the PUT from origin ${origin}`);

    const result = await page.evaluate(async (host) => {
      const url = `https://${host}/tenants/probe/proposals/probe/clre335-browser-put.pdf`;
      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/pdf' },
          body: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }),
        });
        return { reached: true, status: res.status, error: null as string | null };
      } catch (e) {
        // A CORS refusal lands here — the browser never surfaces a status.
        return { reached: false, status: 0, error: (e as Error).message };
      }
    }, BUCKET_HOST);

    // eslint-disable-next-line no-console
    console.log(`[CLRE-335] reached S3: ${result.reached} status=${result.status} error=${result.error ?? 'none'}`);

    expect(
      result.reached,
      `the browser blocked the PUT before it reached S3 (${result.error}) — this is the ` +
      `net::ERR_ABORTED in CLRE-335, and it means the bucket's CORS policy still does not ` +
      `permit a PUT from ${origin}`,
    ).toBe(true);

    // Unsigned, so S3 must refuse it on authorisation — which proves it got that far.
    expect(
      [400, 403],
      `expected S3 to answer an unsigned PUT with 400/403; got ${result.status}`,
    ).toContain(result.status);
  });
});
