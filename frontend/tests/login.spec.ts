/**
 * CEIQ-FEAT-001 — UI Login & Session (US-1.1).
 * Source: testcases/TC-CEIQ-FEAT-001.md — TC-ADMLOGIN-001/002/003/004/006/007/008.
 *
 * Every test is test(): CEIQ-FEAT-001 admin portal frontend URL not
 * available as of 2026-07-08. Bodies are fully implemented and run the day
 * E2E_BASE_URL exists (set it in automation/frontend/.env).
 */
import { test, expect, FIXME_DETAILS } from './fixtures/baseTest';
import { Copy } from './fixtures/expectedCopy';
import { paEmail, paPassword } from '../utils/env';

test.describe('US-1.1 Login & Session', () => {
  test(
    'TC-ADMLOGIN-001 valid PA credentials land on Tenant List',
    async ({ loginPage, tenantListPage }) => {
      await loginPage.goto();
      await loginPage.expectLoginScreen();
      await loginPage.expectPasswordMasked();
      await loginPage.login(paEmail(), paPassword());
      // Redirect to the Tenant List: URL changes; grid or "No tenants yet." visible.
      await tenantListPage.expectLanded();
      await tenantListPage.expectGridOrEmptyStateVisible();
    },
  );

  test(
    'TC-ADMLOGIN-002 wrong credentials show generic error; no account enumeration',
    async ({ loginPage }) => {
      await loginPage.goto();
      // 2a — existing account, wrong password. Deliberately-wrong credential
      // from the TC test-data table (not a real secret). Kept to a single
      // failed attempt per account to stay below the lockout threshold.
      await loginPage.login(paEmail(), 'WrongPass1!');
      await loginPage.expectError(Copy.invalidCredentials);
      await loginPage.expectOnLoginScreen();
      const existingAccountError = await loginPage.errorMessageText();
      // 2b — nonexistent account.
      await loginPage.login('no-such-account@example.test', 'AnyPass1!');
      await loginPage.expectError(Copy.invalidCredentials);
      await loginPage.expectOnLoginScreen();
      const nonexistentAccountError = await loginPage.errorMessageText();
      // Identical message — no indication the 2b account does not exist.
      expect(
        nonexistentAccountError,
        'generic error must not reveal whether the account exists',
      ).toBe(existingAccountError);
    },
  );

  test(
    'TC-ADMLOGIN-003 field validation on submit (email format, empty password)',
    async ({ loginPage }) => {
      await loginPage.goto();
      const authRequests = loginPage.trackAuthRequests();
      // 3a — empty email.
      await loginPage.fillEmail('');
      await loginPage.fillPassword('AnyPass1!');
      await loginPage.submit();
      await loginPage.expectError(Copy.invalidEmail);
      // 3b — invalid email format.
      await loginPage.fillEmail('not-an-email');
      await loginPage.fillPassword('AnyPass1!');
      await loginPage.submit();
      await loginPage.expectError(Copy.invalidEmail);
      // 3c — empty password.
      await loginPage.fillEmail(paEmail());
      await loginPage.fillPassword('');
      await loginPage.submit();
      await loginPage.expectError(Copy.passwordRequired);
      // All sub-cases: user remains on Login; no Cognito call was made.
      await loginPage.expectOnLoginScreen();
      expect(
        authRequests.count(),
        'no auth network request may fire for client-side validation failures',
      ).toBe(0);
      authRequests.stop();
    },
  );

  test(
    'TC-ADMLOGIN-004 password eye toggle reveals and re-masks without changing the value',
    async ({ loginPage }) => {
      const password = 'Xy9!secretValue'; // TC test-data value, not a credential
      await loginPage.goto();
      await loginPage.fillPassword(password);
      await loginPage.expectPasswordMasked();
      await loginPage.togglePasswordVisibility();
      await loginPage.expectPasswordRevealed();
      await loginPage.expectPasswordValue(password);
      await loginPage.togglePasswordVisibility();
      await loginPage.expectPasswordMasked();
      await loginPage.expectPasswordValue(password);
    },
  );

  test(
    'TC-ADMLOGIN-006 logout ends the session and returns to Login',
    async ({ authenticatedTenantList, loginPage, tenantListPage }) => {
      // authenticatedTenantList fixture: logged in, on the Tenant List.
      await expect(authenticatedTenantList.createTenantButton).toBeVisible();
      await loginPage.logout();
      await loginPage.expectOnLoginScreen();
      // Direct navigation back to the Tenant List URL — session is gone.
      await tenantListPage.goto();
      await loginPage.expectOnLoginScreen();
    },
  );

  test(
    'TC-ADMLOGIN-007 session gating: protected routes redirect out; Login redirects in',
    async ({ loginPage, tenantListPage, createTenantPage }) => {
      // 7a — Tenant List URL while logged out → Login; protected content never renders.
      await tenantListPage.goto();
      await loginPage.expectOnLoginScreen();
      await tenantListPage.expectProtectedContentHidden();
      // 7b — Create Tenant URL while logged out → Login.
      await createTenantPage.goto();
      await loginPage.expectOnLoginScreen();
      // 7c — already-logged-in PA visiting Login → redirected to the Tenant List.
      await loginPage.login(paEmail(), paPassword());
      await tenantListPage.expectLanded();
      await loginPage.goto();
      await tenantListPage.expectLanded();
    },
  );

  test(
    'TC-ADMLOGIN-008 email matching is case-insensitive and trimmed',
    async ({ loginPage, tenantListPage }) => {
      // 8a — upper-cased email with the correct password.
      await loginPage.goto();
      await loginPage.login(paEmail().toUpperCase(), paPassword());
      await tenantListPage.expectLanded();
      await loginPage.logout();
      await loginPage.expectOnLoginScreen();
      // 8b — leading/trailing whitespace around the email.
      await loginPage.login(`  ${paEmail()}  `, paPassword());
      await tenantListPage.expectLanded();
    },
  );
});
