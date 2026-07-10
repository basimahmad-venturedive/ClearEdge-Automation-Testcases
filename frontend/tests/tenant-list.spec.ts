/**
 * CEIQ-FEAT-001 — UI Tenant List (US-2.1).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMLIST-001…011.
 *
 * Every test is test.fixme(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 *
 * TODO_FIXTURE: each test states its seed precondition in a comment; wire
 * API-based seed/teardown fixtures (automation/api-ts) once the backend
 * environment exists.
 */
import { test, expect, FIXME_DETAILS } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { SETUP_TENANT, HANDED_OVER_TENANT, uniqueTenant } from './fixtures/testData';

test.describe('US-2.1 Tenant List', () => {
  test.fixme(
    'TC-ADMLIST-001 tenant card renders every specified element',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): SETUP_TENANT seeded in Setup;
      // HANDED_OVER_TENANT seeded Handed Over.
      // Setup tenant card: all elements + "Setup" badge top-right.
      await list.expectCardCoreElements(SETUP_TENANT.companyName);
      await list.expectCardBadge(SETUP_TENANT.companyName, 'Setup');
      // Handed-Over tenant card: same layout, badge "Handed Over" (the badge
      // slot never shows Active/Inactive — status is the plain-text label).
      await list.expectCardCoreElements(HANDED_OVER_TENANT.companyName);
      await list.expectCardBadge(HANDED_OVER_TENANT.companyName, 'Handed Over');
      // Website link opens in a NEW TAB with protocol auto-normalized.
      const popup = await list.openCardWebsiteLink(SETUP_TENANT.companyName);
      expect(popup.url(), 'website link protocol-normalized to https').toContain(
        `https://${SETUP_TENANT.websiteUrl}`,
      );
      await popup.close();
      // Owner email is a mailto: link.
      await list.expectCardOwnerEmailIsMailto(SETUP_TENANT.companyName, SETUP_TENANT.ownerEmail);
    },
  );

  test.fixme(
    'TC-ADMLIST-002 newest-first ordering; newly created tenant appears at the top of page 1',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): ≥ 3 tenants with distinct creation times.
      const newTenant = uniqueTenant();
      const previousFirstCard = await list.firstCardName();
      await list.openCreateTenant();
      await createTenantPage.fillForm(newTenant);
      await createTenantPage.submit();
      await list.expectLanded();
      // New tenant is the FIRST card on page 1; prior order preserved below it.
      await list.expectFirstCard(newTenant.companyName);
      await list.expectCardAt(1, previousFirstCard);
      // Edit the OLDEST tenant (last card of a single-page dataset) — ordering
      // is by creation date only, so it must NOT move.
      const oldestTenant = await list.lastCardName();
      await list.openProfile(oldestTenant);
      await profile.editCompanySection();
      await profile.fillCompanyAddress('7 Reordered Court, Test City');
      await profile.saveCompanySection();
      await profile.closeProfile();
      await list.reload();
      await list.expectLastCard(oldestTenant);
      // Cleanup (TODO_FIXTURE): deactivate/namespace newTenant — no delete exists.
    },
  );

  test.fixme(
    'TC-ADMLIST-003 pagination boundary: 12 per page; controls appear only above 12',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // 3a — Precondition (TODO_FIXTURE): EXACTLY 12 tenants seeded.
      await list.expectCardCount(12);
      await list.expectPaginationHidden();
      // 3b — Precondition (TODO_FIXTURE): a 13th tenant seeded, then reload.
      await list.reload();
      await list.expectCardCount(12);
      await list.expectPaginationVisible();
      await list.goToPage(2);
      // Page 2 shows exactly 1 card — the OLDEST tenant (newest-first across pages).
      await list.expectCardCount(1);
    },
  );

  test.fixme(
    'TC-ADMLIST-004 search filters by Company Name only, partial and case-insensitive',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): SETUP_TENANT ("Acme Logistics", owner
      // "Sarah Chen"), plus tenants whose owner email contains "acme" but whose
      // company name does not.
      const subCases: ReadonlyArray<{ subId: string; input: string; matches: boolean }> = [
        { subId: '4a', input: 'acme', matches: true }, // lowercase, partial
        { subId: '4b', input: 'ACME', matches: true }, // case-insensitive
        { subId: '4c', input: 'Sarah', matches: false }, // owner name is NOT searched
        { subId: '4d', input: 'TEN00', matches: false }, // tenant ID is NOT searched
      ];
      for (const subCase of subCases) {
        await list.searchTenants(subCase.input);
        if (subCase.matches) {
          await list.expectCardCount(1);
          await list.expectFirstCard(SETUP_TENANT.companyName);
        } else {
          await list.expectCardCount(0);
          await list.expectNoMatchMessage(subCase.input);
        }
        await list.clearSearch();
      }
    },
  );

  test.fixme(
    'TC-ADMLIST-005 whitespace-only search = unfiltered; clearing search restores the full list',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): ≥ 2 tenants seeded.
      const total = await list.tenantCountValue();
      // 5a — spaces only: treated as an empty search (unfiltered list).
      await list.searchTenants('   ');
      await list.expectTenantCount(total);
      // 5b — type a real filter, then clear: full list restored.
      await list.searchTenants('acme');
      await list.clearSearch();
      await list.expectTenantCount(total);
    },
  );

  test.fixme(
    'TC-ADMLIST-006 no-match search shows the empty-results message',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): ≥ 1 tenant seeded, none matching.
      await list.searchTenants('zzz-no-match-xyz');
      // Exact copy including the entered text: No tenants match 'zzz-no-match-xyz'.
      await list.expectNoMatchMessage('zzz-no-match-xyz');
      await list.expectTenantCount(0);
      await list.clearSearch();
    },
  );

  test.fixme(
    'TC-ADMLIST-007 zero tenants: "No tenants yet." with Create Tenant still visible',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): environment with ZERO tenants (fresh DB /
      // isolated tenant-set). If shared environments make that impossible,
      // downgrade to PARTIAL per the TC file.
      await list.expectEmptyState();
      await list.expectPaginationHidden();
      await list.expectCreateTenantEnabled();
    },
  );

  test.fixme(
    'TC-ADMLIST-008 search resets to page 1; filtered results paginate',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): ≥ 14 tenants seeded, ≥ 13 sharing the
      // searchable fragment "Fixture" (e.g. "Fixture Co NN").
      // 8a — searching from page 2 resets the view to page 1 of the results.
      await list.goToPage(2);
      await list.searchTenants('Fixture');
      await list.expectActivePage(1);
      // 8b — > 12 matches paginate: 12 on page 1, remainder on page 2.
      await list.expectCardCount(12);
      await list.expectPaginationVisible();
      await list.goToPage(2);
      await list.expectCardCountAtLeast(1);
      await list.clearSearch();
    },
  );

  test.fixme(
    'TC-ADMLIST-009 running tenant count updates with search',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): N total tenants, M matching "acme" (M < N).
      const total = await list.tenantCountValue();
      await list.searchTenants('acme');
      const filtered = await list.tenantCountValue();
      expect(filtered, 'filtered count reflects matches only').toBeLessThan(total);
      // Count matches the visible filtered results.
      await list.expectCardCount(filtered);
      await list.clearSearch();
      await list.expectTenantCount(total);
    },
  );

  test.fixme(
    'TC-ADMLIST-010 "Create Tenant" navigates to the creation form',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage }) => {
      const mutations = list.trackTenantCreateRequests();
      await list.openCreateTenant();
      // Create Tenant page opens with all five form fields visible.
      await createTenantPage.expectFormVisible();
      // §8.3: the navigation itself fires no tenant API mutation.
      expect(mutations.count(), 'navigation must not fire a tenant mutation').toBe(0);
      mutations.stop();
    },
  );

  test.fixme(
    'TC-ADMLIST-011 responsive grid: multi-column desktop, single column mobile',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): ≥ 4 tenants seeded.
      // Desktop viewport 1440×900 — cards render in more than one column.
      await list.setViewport(1440, 900);
      await list.expectMultiColumnLayout();
      // Mobile viewport 375×812 — single column; card content remains visible.
      await list.setViewport(375, 812);
      await list.expectSingleColumnLayout();
      await list.expectCardCoreElements(SETUP_TENANT.companyName);
    },
  );
});
