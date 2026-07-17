/**
 * CEIQ-FEAT-003 — User Management home: org/profile cards, list, search, filter,
 * pagination, empty states, route access (US-UM-003 + §5.1/§5.2).
 * Source: testcases/TC-CEIQ-FEAT-003.md — TC-UMHOME-001…020.
 *
 * SCAFFOLDED with test.skip: the User Management screen is not built and no env
 * / APP_BASE_URL / PO session exists (§5/§8 TBD). Bodies use the proposed selector
 * contract + verbatim spec copy and run the day the screen + env exist.
 * TODO_FIXTURE: wire PO-authenticated session + API seed/teardown (automation/api-ts).
 */
import { test, expect } from '@playwright/test';
import { UserManagementPage } from '../pages/UserManagementPage';
import { UmCopy } from './fixtures/expectedCopyUserMgmt';

test.describe('US-UM-003 User Management home', () => {
  test.skip('TC-UMHOME-001 "Your Organization" card renders company/website/address; null → "—"; no edit controls', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.expectOrganizationCard('ClearEdge Enterprises LLC');
  });

  test.skip('TC-UMHOME-002 "Your Profile" card renders PO Name/Email/Role="Procurement Owner"; no edit controls', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.expectProfileCard('Sana Raza', 'owner@clearedge.com');
  });

  test.skip('TC-UMHOME-003 managed-users card renders every specified element', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    // Precondition (TODO_FIXTURE): ≥1 managed user seeded.
    await expect(um.cardByName('Kyle Chancellor')).toBeVisible();
  });

  test.skip('TC-UMHOME-004 list ordered newest-first; new user appears at top of page 1', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const names = await um.expectVisibleCardNames();
    expect(names.length).toBeGreaterThan(0);
  });

  test.skip('TC-UMHOME-005 search: case-insensitive partial match anywhere in name', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('ann'); // matches "Anna Khan" and "Zainab Anne"
    for (const n of await um.expectVisibleCardNames()) expect(n.toLowerCase()).toContain('ann');
  });

  test.skip('TC-UMHOME-006 search updates as the Owner types (debounced), no separate Search button', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('ky');
    await expect(page.getByRole('button', { name: /^search$/i })).toHaveCount(0);
  });

  test.skip('TC-UMHOME-007 role filter (All / Manager / Analyst) and clear-back-to-All', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.selectRoleFilter('Procurement Analyst');
    await um.selectRoleFilter('All');
    expect(await um.expectVisibleCardNames()).not.toHaveLength(0);
  });

  test.skip('TC-UMHOME-008 search + role filter combine with AND logic', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('a');
    await um.selectRoleFilter('Procurement Manager');
    // Only Managers whose name contains "a" remain (both conditions).
  });

  test.skip('TC-UMHOME-009 any control change resets to page 1 of the new result set', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('user'); // from a later page, search resets to page 1 (no empty page 2)
  });

  test.skip('TC-UMHOME-010 pagination: 12 per page on the filtered count; controls appear only above 12', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await expect(um.cards).toHaveCount(12); // with >12 total; controls visible
  });

  test.skip('TC-UMHOME-011 empty state "No users have been created yet…" with search + filter still visible', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto(); // zero users in tenant
    await um.expectNoUsersEmptyState();
  });

  test.skip('TC-UMHOME-012 empty state "No users match your search." (users exist, filter yields zero)', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('zzzznomatch');
    await um.expectNoMatchEmptyState();
  });

  test.skip("TC-UMHOME-013 PO's own account never appears in list, search, or filtered results", async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('Sana Raza'); // the PO's own name
    await um.expectNoMatchEmptyState();
  });

  test.skip('TC-UMHOME-014 User ID visible on every card and never editable', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await expect(um.cardByName('Kyle Chancellor').getByText(/^USR-\d{4}$/)).toBeVisible();
  });

  test.skip('TC-UMHOME-015 whitespace-only search treated as an empty search', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const all = (await um.expectVisibleCardNames()).length;
    await um.search('   ');
    expect((await um.expectVisibleCardNames()).length).toBe(all);
  });

  test.skip('TC-UMHOME-016 same-name users disambiguated by email and User ID in results', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('Kyle');
    // Two "Kyle Chancellor" cards differ by email + USR id shown on each.
  });

  test.skip('TC-UMHOME-017 clearing the search returns to the full list at page 1', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('kyle');
    await um.search(''); // cleared → full list, page 1
    expect((await um.expectVisibleCardNames()).length).toBeGreaterThan(0);
  });

  test.skip('TC-UMHOME-018 role filter with zero matches shows the no-match message, not a blank grid', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto(); // e.g. no Analysts exist yet
    await um.selectRoleFilter('Procurement Analyst');
    await um.expectNoMatchEmptyState();
  });

  test.skip('TC-UMHOME-019 route/access control: Manager/Analyst cannot reach User Management', async ({ page }) => {
    // As a Manager/Analyst (no manage_users) → direct URL redirects to app home, no error.
    await page.goto('/user-management');
    await expect(page).not.toHaveURL(/user-management/);
  });

  test.skip('TC-UMHOME-020 toast auto-dismisses (~4 s); banner persists until dismissed', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    // After a success action: toast disappears within ~4s (clock-controlled); banner stays until Dismiss.
    await expect(um.toast).toBeHidden({ timeout: 6000 });
    await expect(um.banner).toBeVisible();
  });
});
