/**
 * CEIQ-FEAT-011 — Analyst role gating on the Dashboard.
 * Source: testcases/TC-CEIQ-FEAT-011.md — TC-DASHUI-005 / TC-DASHUI-009 (Analyst half).
 *
 * Runs under the `analyst` project (Procurement-Analyst storageState) against QA.
 * Read-only.
 *
 * The assertion is ABSENCE FROM THE DOM, not disabled-ness. A disabled-but-present
 * button still leaks the affordance, and the implementation conditionally renders,
 * so the stronger assertion is also the accurate one.
 */
import { test, expect } from '@playwright/test';
import { DashboardPage, type SummaryPayload } from '../pages/DashboardPage';
import { DashboardCopy, DashboardApi } from './fixtures/expectedCopyDashboard';

test.use({ timezoneId: 'America/Chicago' });

test.describe('Dashboard — Analyst role gating (US-DASH-001 AC-002/AC-003; Tech §5.3)', () => {
  test('TC-DASHUI-005/009 — the Analyst sees the Dashboard but neither "Create new" button @smoke @regression', async ({ page }) => {
    const dash = new DashboardPage(page);
    const data = await dash.gotoCapturing<SummaryPayload>(DashboardApi.summary);

    // The read surface is identical — only the create affordance differs (§5.1).
    await expect(dash.headerTitle()).toBeVisible();
    await expect(dash.headerSubtitle()).toBeVisible();
    await expect(dash.recentActivityCard()).toBeVisible();
    await expect(dash.renewalsCard()).toBeVisible();
    await expect(dash.activeSourcingCard()).toBeVisible();

    expect(data.canCreate, 'the Analyst fixture user must not hold both manage rights').toBe(false);
    await expect(
      page.getByRole('button', { name: DashboardCopy.panels.createNew, exact: true }),
      'no "Create new" button may exist in the DOM for the Analyst role',
    ).toHaveCount(0);
  });
});
