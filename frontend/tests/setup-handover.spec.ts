/**
 * CEIQ-FEAT-001 — UI Setup Password / Setup Banner (US-4.1, §8.6/§8.7) and
 * Handover (US-4.2).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMSETUP-001/002,
 * TC-ADMHAND-001/002/003/004.
 * (TC-ADMSETUP-003 and TC-ADMHAND-005 are MANUAL-ONLY / PARTIAL — out of scope.)
 *
 * Data is seeded per-test via the admin API (utils/adminApi.ts) and isolated by
 * searching the seeded tenant's unique name — dev is shared and has no delete.
 */
import { test, expect } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { seedSetupTenant, seedHandedOverTenant } from '../utils/adminApi';

test.describe('US-4.1 Setup Password & Setup Banner', () => {
  test(
    'TC-ADMSETUP-001 setup password displayed in profile with show/hide; stable across views @smoke @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedSetupTenant(seeder);
      await list.searchTenants(t.companyName);
      // 1–2. Open the profile: password present but masked by default.
      await list.openProfile(t.companyName);
      await profile.expectSetupPasswordVisible();
      // 3. Show reveals plaintext; capture the revealed value.
      const revealed = await profile.revealAndReadSetupPassword();
      expect(revealed.length, 'setup password reveals a non-empty value').toBeGreaterThan(0);
      // 4. Close and reopen; the SAME value is shown — not regenerated on repeat views.
      await profile.closeProfile();
      await list.openProfile(t.companyName);
      const revealedAgain = await profile.revealAndReadSetupPassword();
      expect(revealedAgain, 'setup password is stable across views (not regenerated)').toBe(revealed);
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMSETUP-002 setup banner: exact copy during Setup; disappears permanently after handover @smoke @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const setup = await seedSetupTenant(seeder);
      const handedOver = await seedHandedOverTenant(seeder);
      // 2a — banner visible with exact §8.6 heading, body, and action button.
      await list.searchTenants(setup.companyName);
      await list.openProfile(setup.companyName);
      await profile.expectSetupBanner(Copy.setupBannerHeading, Copy.setupBannerBody);
      await profile.closeProfile();
      // 2b — banner absent on a Handed-Over tenant.
      await list.searchTenants(handedOver.companyName);
      await list.openProfile(handedOver.companyName);
      await profile.expectSetupBannerAbsent();
      await profile.closeProfile();
    },
  );
});

test.describe('US-4.2 Handover', () => {
  test(
    'TC-ADMHAND-001 handover action available only during Setup; dialog copy is exact and named @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const setup = await seedSetupTenant(seeder);
      const handedOver = await seedHandedOverTenant(seeder);
      // 1a — button present; exact dialog copy interpolating Owner + Company.
      await list.searchTenants(setup.companyName);
      await list.openProfile(setup.companyName);
      await profile.expectHandoverButtonVisible();
      await profile.clickHandover();
      await profile.dialog.expectText(Copy.handoverDialog(setup.ownerName, setup.companyName));
      // Cancel — no handover in this case.
      await profile.dialog.cancel();
      await profile.closeProfile();
      // 1b — the handover button is absent on a Handed-Over tenant.
      await list.searchTenants(handedOver.companyName);
      await list.openProfile(handedOver.companyName);
      await profile.expectHandoverButtonAbsent();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMHAND-002 confirmed handover applies all UI effects together @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedSetupTenant(seeder); // disposable Setup tenant; handover is irreversible
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
      // 1. Trigger handover; confirm → exact toast "Invite sent. Handover complete."
      await profile.clickHandover();
      await profile.dialog.confirm();
      await profile.expectToast(Copy.handoverToast);
      // 2. Profile: badge "Handed Over"; toggle enabled + Active; banner gone;
      // PO section shows post-handover text with today's date; setup password gone.
      await profile.expectBadge('Handed Over');
      await profile.expectToggleEnabled();
      await profile.expectStatusLabel('Active');
      await profile.expectSetupBannerAbsent();
      await profile.expectPostHandoverInfo(Copy.postHandoverInfoPattern);
      await profile.expectPostHandoverDateIsToday();
      await profile.expectSetupPasswordAbsent();
      // 3. Card badge/toggle match.
      await profile.closeProfile();
      await list.expectCardBadge(t.companyName, 'Handed Over');
      await list.expectCardStatusLabel(t.companyName, 'Active');
      // 4. State persists after a reload — setup password never reappears.
      await list.reload();
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
      await profile.expectSetupPasswordAbsent();
      await profile.expectPostHandoverInfo(Copy.postHandoverInfoPattern);
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMHAND-003 canceling the handover dialog performs none of the effects @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedSetupTenant(seeder);
      await list.searchTenants(t.companyName);
      const handoverRequests = list.trackHandoverPostRequests();
      await list.openProfile(t.companyName);
      // 1. Trigger the handover dialog. 2. Cancel.
      const passwordBefore = await profile.revealAndReadSetupPassword();
      await profile.clickHandover();
      await profile.dialog.cancel();
      // 3. Badge still "Setup"; toggle disabled/Inactive; setup password unchanged; no POST.
      await profile.expectBadge('Setup');
      await profile.expectToggleDisabled();
      await profile.expectStatusLabel('Inactive');
      await profile.expectSetupPasswordVisible();
      const passwordAfter = await profile.revealAndReadSetupPassword();
      expect(passwordAfter, 'setup password unchanged after cancel').toBe(passwordBefore);
      expect(handoverRequests.count(), 'cancel must not fire POST …/handover').toBe(0);
      handoverRequests.stop();
      await profile.closeProfile();
    },
  );

  test(
    'TC-ADMHAND-004 post-handover text is static: unaffected by later PO edits; date = handover date @regression',
    async ({ authenticatedTenantList: list, tenantProfilePage: profile, seeder }) => {
      const t = await seedSetupTenant(seeder); // disposable; will be handed over below
      await list.searchTenants(t.companyName);
      await list.openProfile(t.companyName);
      await profile.completeHandover();
      // 1. Date equals the HANDOVER date (setup_completed_at ≈ today), not createdAt.
      await profile.expectPostHandoverInfo(Copy.postHandoverInfoPattern);
      await profile.expectPostHandoverDateIsToday();
      const extractInfoSentence = (sectionText: string): string => {
        const match = Copy.postHandoverInfoPattern.exec(sectionText);
        expect(match, `post-handover sentence present ("${sectionText}")`).not.toBeNull();
        return (match as RegExpExecArray)[0];
      };
      const infoBefore = extractInfoSentence(await profile.postHandoverInfoText());
      // 2. Edit the PO name; save (name-only → no dialog).
      await profile.editOwnerSection();
      await profile.fillOwnerName('Whitfield Thomas');
      await profile.saveOwnerSection();
      await profile.expectOwnerSectionReadOnly();
      // 3. Informational text unchanged after the PO edit.
      await profile.closeProfile();
      await list.openProfile(t.companyName);
      const infoAfter = extractInfoSentence(await profile.postHandoverInfoText());
      expect(infoAfter, 'post-handover text is static across PO edits').toBe(infoBefore);
      await profile.closeProfile();
    },
  );
});
