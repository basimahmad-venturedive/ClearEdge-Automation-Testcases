/**
 * CEIQ-FEAT-011 — Procurement-Manager parity on the Dashboard.
 * Source: testcases/TC-CEIQ-FEAT-011.md — TC-DASHUI-005 / TC-DASHUI-009 (Manager half).
 *
 * Runs under the `pm` project (Procurement-Manager storageState) against QA. Read-only.
 *
 * The Manager is the case that keeps the Analyst assertion honest: if "Create new"
 * were hidden for everyone, the Analyst spec would still pass. This one proves the
 * button exists for a non-Owner role that holds the manage rights.
 */
import { test, expect } from '@playwright/test';
import { DashboardPage, type SummaryPayload } from '../pages/DashboardPage';
import { DashboardCopy, DashboardApi } from './fixtures/expectedCopyDashboard';

test.use({ timezoneId: 'America/Chicago' });

test.describe('Dashboard — Manager role parity (US-DASH-001 AC-002/AC-003; Tech §5.3)', () => {
  test('TC-DASHUI-005/009 — the Manager sees both "Create new" buttons @regression', async ({ page }) => {
    const dash = new DashboardPage(page);
    const data = await dash.gotoCapturing<SummaryPayload>(DashboardApi.summary);

    expect(data.canCreate, 'the Manager fixture user should hold both manage rights').toBe(true);
    await expect(
      page.getByRole('button', { name: DashboardCopy.panels.createNew, exact: true }),
      'the Manager must see a "Create new" button in each summary panel',
    ).toHaveCount(2);
    await expect(dash.createNewButton('contracts')).toBeEnabled();
    await expect(dash.createNewButton('sourcing')).toBeEnabled();
  });
});
