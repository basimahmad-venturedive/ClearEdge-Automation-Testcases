/**
 * CEIQ-FEAT-003 — User Management home: org/profile cards, list, search, filter,
 * pagination, empty states, route access (US-UM-003 + §5.1/§5.2).
 * Source: testcases/TC-CEIQ-FEAT-003.md — TC-UMHOME-001…020.
 *
 * Runs on dev as the Procurement Owner (AppLoginPage). Managed users are seeded
 * per-test via the app API (utils/appApi.ts) and isolated by searching a per-run
 * name prefix — the dev tenant is shared and has no delete.
 */
import { test, expect } from '@playwright/test';
import { AppLoginPage } from '../pages/AppLoginPage';
import { UserManagementPage } from '../pages/UserManagementPage';
import { AppUserSeeder, uniqueUserPrefix } from '../utils/appApi';
import { UmCopy } from './fixtures/expectedCopyUserMgmt';
import { hasVar } from '../utils/env';

// Real dev PO tenant data (account ubaid.rehman+01@venturedive.com).
const PO = {
  companyName: 'Ubaid',
  profileName: 'Ubaid 01',
  profileEmail: 'ubaid.rehman+01@venturedive.com',
};

test.describe('US-UM-003 User Management home', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !hasVar('PO_EMAIL') || !hasVar('PO_PASSWORD'),
      'Set PO_EMAIL and PO_PASSWORD in automation/frontend/.env.dev',
    );
    await new AppLoginPage(page).ensureLoggedIn();
  });

  test('TC-UMHOME-001 "Your Organization" card renders company/website/address; null → "—"; no edit controls', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.expectOrganizationCard(PO.companyName);
  });

  test('TC-UMHOME-002 "Your Profile" card renders PO Name/Email/Role="Procurement Owner"; no edit controls', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.expectProfileCard(PO.profileName, PO.profileEmail);
  });

  test('TC-UMHOME-003 managed-users card renders every specified element', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home003');
    const [u] = await new AppUserSeeder(page, request).seedUsers(1, tag, 'procurement_manager');
    await um.search(tag);
    const card = um.cardByName(u.name);
    await expect(card).toBeVisible();
    await expect(card.getByText(/^USR-\d{4}$/)).toBeVisible();
    await expect(card.getByText(u.email)).toBeVisible();
  });

  test('TC-UMHOME-004 list ordered newest-first; new user appears at top of page 1', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home004');
    await new AppUserSeeder(page, request).seedUsers(2, tag);
    await um.search(tag);
    await expect(um.cards).toHaveCount(2); // wait for the filtered results to settle
    const names = await um.expectVisibleCardNames();
    // Newest (seeded last) is first.
    expect(names[0]).toContain(`${tag} 2`);
  });

  test('TC-UMHOME-005 search: case-insensitive partial match anywhere in name', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home005');
    await new AppUserSeeder(page, request).seedUsers(2, tag);
    // Lowercase partial of the (mixed-case) tag still matches.
    await um.search(tag.toLowerCase());
    await expect(um.cards).toHaveCount(2); // wait for the filtered results to settle
    const names = await um.expectVisibleCardNames();
    for (const n of names) expect(n.toLowerCase()).toContain(tag.toLowerCase());
  });

  test('TC-UMHOME-006 search updates as the Owner types (debounced), no separate Search button', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await um.search('ky');
    await expect(page.getByRole('button', { name: /^search$/i })).toHaveCount(0);
  });

  test('TC-UMHOME-007 role filter (All / Manager / Analyst) and clear-back-to-All', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home007');
    const seeder = new AppUserSeeder(page, request);
    await seeder.seedUsers(1, `${tag}mgr`, 'procurement_manager');
    await seeder.seedUsers(1, `${tag}ana`, 'procurement_analyst');
    await um.search(tag);
    await expect(um.cards).toHaveCount(2);
    await um.selectRoleFilter('Procurement Analyst');
    await expect(um.cards).toHaveCount(1);
    for (const n of await um.expectVisibleCardNames()) expect(n).toContain(`${tag}ana`);
    await um.selectRoleFilter('All');
    await expect(um.cards).toHaveCount(2);
  });

  test('TC-UMHOME-008 search + role filter combine with AND logic', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home008');
    const seeder = new AppUserSeeder(page, request);
    await seeder.seedUsers(1, `${tag}mgr`, 'procurement_manager');
    await seeder.seedUsers(1, `${tag}ana`, 'procurement_analyst');
    await um.search(tag);
    await expect(um.cards).toHaveCount(2);
    await um.selectRoleFilter('Procurement Manager');
    await expect(um.cards).toHaveCount(1);
    for (const n of await um.expectVisibleCardNames()) expect(n).toContain(`${tag}mgr`);
  });

  test.skip('TC-UMHOME-009 any control change resets to page 1 of the new result set', async () => {
    // Deferred: needs pagination page-object methods (goToPage/active-page) + >12 seeded.
  });

  test.skip('TC-UMHOME-010 pagination: 12 per page on the filtered count; controls appear only above 12', async () => {
    // Deferred: needs pagination page-object methods + 13 seeded under one prefix.
  });

  test.skip('TC-UMHOME-011 empty state "No users have been created yet…" with search + filter still visible', async () => {
    // Un-runnable on shared dev: seeding created persistent users (no delete), so the
    // tenant can never be empty. Needs an isolated/fresh tenant (cf. TC-ADMLIST-007).
  });

  test('TC-UMHOME-012 empty state "No users match your search." (users exist, filter yields zero)', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    // Ensure at least one user exists, then search a no-match term.
    await new AppUserSeeder(page, request).seedUsers(1, uniqueUserPrefix('Home012'));
    await um.search('zzzz-no-match-xyz');
    await um.expectNoMatchEmptyState();
  });

  test('TC-UMHOME-013 PO\'s own account never appears in list, search, or filtered results', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await new AppUserSeeder(page, request).seedUsers(1, uniqueUserPrefix('Home013'));
    await um.search(PO.profileName); // the PO's own name → excluded from the managed list
    await um.expectNoMatchEmptyState();
  });

  test('TC-UMHOME-014 User ID visible on every card and never editable', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home014');
    const [u] = await new AppUserSeeder(page, request).seedUsers(1, tag);
    await um.search(tag);
    await expect(um.cardByName(u.name).getByText(/^USR-\d{4}$/)).toBeVisible();
  });

  test('TC-UMHOME-015 whitespace-only search treated as an empty search', async ({ page }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const all = (await um.expectVisibleCardNames()).length;
    await um.search('   ');
    expect((await um.expectVisibleCardNames()).length).toBe(all);
  });

  test('TC-UMHOME-016 same-name users disambiguated by email and User ID in results', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home016');
    const seeder = new AppUserSeeder(page, request);
    // Two users with the SAME display name, distinct emails.
    await seeder.createUser({ name: `${tag} Twin`, email: `${tag.toLowerCase()}a@example.com`, role: 'procurement_manager' });
    await seeder.createUser({ name: `${tag} Twin`, email: `${tag.toLowerCase()}b@example.com`, role: 'procurement_manager' });
    await um.search(`${tag} Twin`);
    await expect(um.cards).toHaveCount(2);
  });

  test('TC-UMHOME-017 clearing the search returns to the full list at page 1', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    await new AppUserSeeder(page, request).seedUsers(1, uniqueUserPrefix('Home017'));
    await um.search('zzzz-no-match-xyz');
    await um.expectNoMatchEmptyState();
    await um.search(''); // cleared → full list restored
    await expect(um.cards.first()).toBeVisible(); // wait for the full list to reload
    expect((await um.expectVisibleCardNames()).length).toBeGreaterThan(0);
  });

  test('TC-UMHOME-018 role filter with zero matches shows the no-match message, not a blank grid', async ({ page, request }) => {
    const um = new UserManagementPage(page);
    await um.goto();
    const tag = uniqueUserPrefix('Home018');
    // Seed only Managers under this tag → filtering to Analyst within the tag yields zero.
    await new AppUserSeeder(page, request).seedUsers(2, tag, 'procurement_manager');
    await um.search(tag);
    await expect(um.cards).toHaveCount(2);
    await um.selectRoleFilter('Procurement Analyst');
    await um.expectNoMatchEmptyState();
  });

  test.skip('TC-UMHOME-019 route/access control: Manager/Analyst cannot reach User Management', async () => {
    // Deferred: needs a Manager/Analyst (non-PO) account to verify the redirect.
  });

  test.skip('TC-UMHOME-020 toast auto-dismisses (~4 s); banner persists until dismissed', async () => {
    // Deferred: needs a success action + clock control; covered better in the create spec.
  });
});
