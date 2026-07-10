/**
 * CEIQ-FEAT-001 — UI Setup Password / Setup Banner (US-4.1, §8.6/§8.7) and
 * Handover (US-4.2).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMSETUP-001/002,
 * TC-ADMHAND-001/002/003/004.
 * (TC-ADMSETUP-003 and TC-ADMHAND-005 are MANUAL-ONLY / PARTIAL — out of scope
 * for this Playwright spec.)
 *
 * Every test is test.fixme(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists.
 */
import { test, expect, FIXME_DETAILS } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { SETUP_TENANT, HANDED_OVER_TENANT, uniqueTenant } from './fixtures/testData';

test.describe('US-4.1 Setup Password & Setup Banner', () => {
  test.fixme(
    'TC-ADMSETUP-001 setup password displayed in profile with show/hide; stable across views',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Freshly created Setup tenant → create a DISPOSABLE one.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      await list.expectLanded();
      // 1–2. Open the profile immediately: password present but masked by default.
      await list.openProfile(tenant.companyName);
      await profile.expectSetupPasswordVisible();
      // 3. Show reveals plaintext; hide re-masks; capture the revealed value.
      const revealed = await profile.revealAndReadSetupPassword();
      expect(revealed.length, 'setup password reveals a non-empty value').toBeGreaterThan(0);
      // 4. Close and reopen; the SAME value is shown — not regenerated on repeat views.
      await profile.closeProfile();
      await list.openProfile(tenant.companyName);
      const revealedAgain = await profile.revealAndReadSetupPassword();
      expect(revealedAgain, 'setup password is stable across views (not regenerated)').toBe(revealed);
      // Fixture is disposable.
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMSETUP-002 setup banner: exact copy during Setup; disappears permanently after handover',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): 2a Setup tenant · 2b Handed-Over tenant.
      // 2a — banner visible with exact §8.6 heading, body, and action button.
      await list.openProfile(SETUP_TENANT.companyName);
      await profile.expectSetupBanner(Copy.setupBannerHeading, Copy.setupBannerBody);
      await profile.closeProfile();
      // 2b — banner absent on a Handed-Over tenant.
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      await profile.expectSetupBannerAbsent();
      await profile.closeProfile();
    },
  );
});

test.describe('US-4.2 Handover', () => {
  test.fixme(
    'TC-ADMHAND-001 handover action available only during Setup; dialog copy is exact and named',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): 1a Setup tenant (Owner "Sarah Chen",
      // Company "Acme Logistics") · 1b Handed-Over tenant.
      // 1a — button present; exact dialog copy interpolating Owner + Company +
      // all four consequences + irreversibility.
      await list.openProfile(SETUP_TENANT.companyName);
      await profile.expectHandoverButtonVisible();
      await profile.clickHandover();
      await profile.dialog.expectText(
        Copy.handoverDialog(SETUP_TENANT.ownerName, SETUP_TENANT.companyName),
      );
      // Cancel — no handover in this case.
      await profile.dialog.cancel();
      await profile.closeProfile();
      // 1b — the handover button is absent on a Handed-Over tenant.
      await list.openProfile(HANDED_OVER_TENANT.companyName);
      await profile.expectHandoverButtonAbsent();
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMHAND-002 confirmed handover applies all UI effects together',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Handover is irreversible → create a DISPOSABLE Setup tenant.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      await list.expectLanded();
      await list.openProfile(tenant.companyName);
      // 1. Trigger handover; confirm → exact toast "Invite sent. Handover complete."
      await profile.clickHandover();
      await profile.dialog.confirm();
      await profile.expectToast(Copy.handoverToast);
      // 2. Profile: badge "Handed Over"; toggle enabled + Active; banner gone;
      // PO section shows the post-handover informational text with today's date;
      // setup-password display gone.
      await profile.expectBadge('Handed Over');
      await profile.expectToggleEnabled();
      await profile.expectStatusLabel('Active');
      await profile.expectSetupBannerAbsent();
      await profile.expectPostHandoverInfo(Copy.postHandoverInfoPattern);
      await profile.expectPostHandoverDateIsToday();
      await profile.expectSetupPasswordAbsent();
      // 3. Card badge/toggle match.
      await profile.closeProfile();
      await list.expectCardBadge(tenant.companyName, 'Handed Over');
      await list.expectCardStatusLabel(tenant.companyName, 'Active');
      // 4. State persists after a reload — setup password never reappears.
      await list.reload();
      await list.openProfile(tenant.companyName);
      await profile.expectSetupPasswordAbsent();
      await profile.expectPostHandoverInfo(Copy.postHandoverInfoPattern);
      // Fixture is disposable. API/DB effects: TC-ADMAPI-060; email: TC-ADMMAIL-001.
      await profile.closeProfile();
    },
  );

  test.fixme(
    'TC-ADMHAND-003 canceling the handover dialog performs none of the effects',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, tenantProfilePage: profile }) => {
      // Precondition (TODO_FIXTURE): Setup tenant.
      const name = SETUP_TENANT.companyName;
      const handoverRequests = list.trackHandoverPostRequests();
      await list.openProfile(name);
      // 1. Trigger the handover dialog. 2. Cancel.
      const passwordBefore = await profile.revealAndReadSetupPassword();
      await profile.clickHandover();
      await profile.dialog.cancel();
      // 3. Badge still "Setup"; toggle disabled/Inactive; setup password
      // unchanged and still displayed; no POST /handover fired.
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

  test.fixme(
    'TC-ADMHAND-004 post-handover text is static: unaffected by later PO edits; date = handover date',
    FIXME_DETAILS,
    async ({ authenticatedTenantList: list, createTenantPage, tenantProfilePage: profile }) => {
      // Handover is irreversible → create + hand over a DISPOSABLE tenant.
      const tenant = uniqueTenant();
      await list.openCreateTenant();
      await createTenantPage.fillForm(tenant);
      await createTenantPage.submit();
      await list.expectLanded();
      await list.openProfile(tenant.companyName);
      await profile.completeHandover();
      // 1. Date equals the HANDOVER date (setup_completed_at ≈ today), not createdAt.
      await profile.expectPostHandoverInfo(Copy.postHandoverInfoPattern);
      await profile.expectPostHandoverDateIsToday();
      // Capture the static informational sentence (the owner name in the section
      // changes with the edit below, so compare only the pinned message text).
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
      await list.openProfile(tenant.companyName);
      const infoAfter = extractInfoSentence(await profile.postHandoverInfoText());
      expect(infoAfter, 'post-handover text is static across PO edits').toBe(infoBefore);
      // Fixture is disposable.
      await profile.closeProfile();
    },
  );
});
