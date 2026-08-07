/**
 * CEIQ-FEAT-001 — UI Tenant List (US-2.1).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMLIST-001…011.
 *
 * Every test is test(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 *
 * TODO_FIXTURE: each test states its seed precondition in a comment; wire
 * API-based seed/teardown fixtures (automation/api-ts) once the backend
 * environment exists.
 */
import { test, expect } from './fixtures/baseTest';
import { uniqueTenant } from './fixtures/testData';
import { uniquePrefix } from '../utils/adminApi';

test.describe('US-2.1 Tenant List', () => {
  test(
    'TC-ADMLIST-001 tenant card renders every specified element @smoke @regression',
    async ({ authenticatedTenantList: list, seeder }) => {
      // Seed a Setup tenant + a Handed-Over tenant under a per-run prefix, then
      // search that prefix to isolate exactly these two cards (dev is shared).
      const tag = uniquePrefix('List001');
      const setup = await seeder.createTenant({
        name: `${tag} Setup Co`,
        websiteUrl: `${tag.toLowerCase()}setup.example.com`,
        address: '221B Baker Street, London, UK',
        ownerName: 'Sarah Chen',
        ownerEmail: `sarah.${tag.toLowerCase()}@example.com`,
      });
      const handedOver = await seeder.createTenant({
        name: `${tag} HandedOver Co`,
        websiteUrl: `${tag.toLowerCase()}ho.example.com`,
        address: '1 Harbour Front Avenue, Singapore',
        ownerName: 'Priya Nair',
        ownerEmail: `priya.${tag.toLowerCase()}@example.com`,
      });
      await seeder.handover(handedOver.id);

      await list.searchTenants(tag);
      // Setup tenant card: all elements + "Setup" badge top-right.
      await list.expectCardCoreElements(setup.name);
      await list.expectCardBadge(setup.name, 'Setup');
      // Handed-Over tenant card: same layout, badge "Handed Over".
      await list.expectCardBadge(handedOver.name, 'Handed Over');
      // Website link href is protocol-normalized and opens in a new tab.
      await list.expectCardWebsiteHref(setup.name, `https://${setup.websiteUrl}`);
      // Owner email is a mailto: link.
      await list.expectCardOwnerEmailIsMailto(setup.name, setup.ownerEmail);
      await list.clearSearch();
    },
  );

  test(
    'TC-ADMLIST-002 newest-first ordering; newly created tenant appears at the top of page 1 @smoke @regression',
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

  test(
    'TC-ADMLIST-003 pagination boundary: 12 per page; controls appear only above 12 @smoke @regression',
    async ({ authenticatedTenantList: list, seeder }) => {
      // 3a — EXACTLY 12 tenants under one prefix -> no pagination in that set.
      const tag12 = uniquePrefix('Pg12');
      await seeder.seedTenants(12, tag12);
      await list.searchTenants(tag12);
      await list.expectCardCount(12);
      await list.expectPaginationHidden();
      // 3b — 13 under another prefix -> paginate: 12 on page 1, 1 on page 2.
      const tag13 = uniquePrefix('Pg13');
      await seeder.seedTenants(13, tag13);
      await list.searchTenants(tag13);
      await list.expectCardCount(12);
      await list.expectPaginationVisible();
      await list.goToPage(2);
      await list.expectCardCount(1);
      await list.clearSearch();
    },
  );

  test(
    'TC-ADMLIST-004 search filters by Company Name only, partial and case-insensitive @regression',
    async ({ authenticatedTenantList: list, seeder }) => {
      // Seed one tenant with a unique company-name fragment (dev is shared and
      // has other "Acme" tenants from prior runs — so we search our own tag).
      const tag = uniquePrefix('Acme');
      const created = await seeder.createTenant({
        name: `${tag} Logistics`,
        websiteUrl: `${tag.toLowerCase()}.example.com`,
        address: '221B Baker Street, London, UK',
        ownerName: `Sarah ${tag}`,
        ownerEmail: `sarah.${tag.toLowerCase()}@example.com`,
      });
      // 4a lowercase partial + 4b uppercase — match on Company Name.
      for (const input of [tag.toLowerCase(), tag.toUpperCase()]) {
        await list.searchTenants(input);
        await list.expectCardCount(1);
        await list.expectFirstCard(created.name);
        await list.clearSearch();
      }
      // 4c owner name is NOT searched · 4d tenant ID is NOT searched → zero matches.
      for (const input of [`Sarah ${tag}`, created.displayId]) {
        await list.searchTenants(input);
        await list.expectCardCount(0);
        await list.expectNoMatchMessage(input);
        await list.clearSearch();
      }
    },
  );

  test(
    'TC-ADMLIST-005 whitespace-only search = unfiltered; clearing search restores the full list @regression',
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

  test(
    'TC-ADMLIST-006 no-match search shows the empty-results message @regression',
    async ({ authenticatedTenantList: list }) => {
      // Precondition (TODO_FIXTURE): ≥ 1 tenant seeded, none matching.
      await list.searchTenants('zzz-no-match-xyz');
      // Exact copy including the entered text: No tenants match 'zzz-no-match-xyz'.
      await list.expectNoMatchMessage('zzz-no-match-xyz');
      await list.expectTenantCount(0);
      await list.clearSearch();
    },
  );

  test(
    'TC-ADMLIST-007 zero tenants: "No tenants yet." with Create Tenant still visible @regression',
    async ({ authenticatedTenantList: list }) => {
      // Un-runnable on a SHARED backend: the "No tenants yet." empty state only renders
      // when the tenant set is truly EMPTY, but the shared QA admin backend already holds
      // many tenants and exposes NO delete endpoint (seeded tenants persist), so zero
      // total can never be reached. The TC file's own precondition calls for a fresh /
      // isolated tenant-set; skip cleanly until one exists (same limitation as TC-UMHOME-011).
      test.skip(true, 'Needs a zero-tenant (fresh/isolated) backend; the shared QA env can never be empty.');
      await list.expectEmptyState();
      await list.expectPaginationHidden();
      await list.expectCreateTenantEnabled();
    },
  );

  test(
    'TC-ADMLIST-008 search resets to page 1; filtered results paginate @regression',
    async ({ authenticatedTenantList: list, seeder }) => {
      // Seed 14 tenants sharing a fragment -> the filtered set paginates (12 + 2).
      const tag = uniquePrefix('Fixture');
      await seeder.seedTenants(14, tag);
      // 8b — > 12 matches paginate: 12 on page 1, remainder on page 2.
      await list.searchTenants(tag);
      await list.expectCardCount(12);
      await list.expectPaginationVisible();
      await list.goToPage(2);
      await list.expectActivePage(2); // wait for page 2 to load before counting
      await list.expectCardCountAtLeast(2);
      // 8a — changing the search resets the view to page 1 of the results.
      await list.searchTenants(tag);
      await list.expectActivePage(1);
      await list.expectCardCount(12);
      await list.clearSearch();
    },
  );

  test(
    'TC-ADMLIST-009 running tenant count updates with search @regression',
    async ({ authenticatedTenantList: list, seeder }) => {
      // Seed a small known set under a unique prefix; the running count must
      // drop to exactly that set when the prefix is searched.
      const tag = uniquePrefix('Cnt');
      await seeder.seedTenants(3, tag);
      await list.reload();
      await list.expectCardCountAtLeast(1); // wait for the unfiltered list to load before reading the count
      const total = await list.tenantCountValue();
      await list.searchTenants(tag);
      await list.expectCardCount(3); // wait for the filtered results to settle
      const filtered = await list.tenantCountValue();
      expect(filtered, 'filtered count reflects matches only').toBe(3);
      expect(filtered, 'filtered count is less than the unfiltered total').toBeLessThan(total);
      await list.expectCardCount(3);
      await list.clearSearch();
      await list.expectTenantCount(total);
    },
  );

  test(
    'TC-ADMLIST-010 "Create Tenant" navigates to the creation form @regression',
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

  test(
    'TC-ADMLIST-011 responsive grid: multi-column desktop, single column mobile @regression',
    async ({ authenticatedTenantList: list, seeder }) => {
      // Seed ≥ 4 tenants under a unique prefix and isolate them by search.
      const tag = uniquePrefix('Grid');
      const seeded = await seeder.seedTenants(4, tag);
      // Desktop viewport 1440×900 — cards render in more than one column.
      await list.setViewport(1440, 900);
      await list.searchTenants(tag);
      await list.expectCardCount(4); // wait for the filtered set before measuring layout
      await list.expectMultiColumnLayout();
      // Mobile viewport 375×812 — single column; card content remains visible.
      await list.setViewport(375, 812);
      await list.expectSingleColumnLayout();
      await list.expectCardCoreElements(seeded[0].name);
      await list.clearSearch();
    },
  );
});
