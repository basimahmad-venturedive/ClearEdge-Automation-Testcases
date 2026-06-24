import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect, attachDiagnostics } from '../../fixtures/webFixtures.js';
import { AuthHelper } from '../../helpers/authHelper.js';
import { SessionManager } from '../../helpers/sessionManager.js';
import { loginTestData } from '../../testdata/loginTestData.js';
import { TAGS } from '../../../common/constants/index.js';

test.beforeEach(async ({ page }) => {
  attachDiagnostics(page);
});

testCase(test, {
  id: 'C10030',
  tags: [TAGS.LOGIN, TAGS.UI],
  title: 'Login module - full login flow with session persistence',
  test: async ({ page, loginPage }) => {
    const email = loginTestData.validUser.email();
    const password = loginTestData.validUser.password();
    test.skip(!email || !password, 'Valid credentials not configured in .env');

    const authHelper = new AuthHelper(page, loginPage);
    const statePath = await authHelper.loginAndSaveState();
    expect(SessionManager.hasStoredSession()).toBeTruthy();
    expect(statePath).toBeTruthy();
  },
});

testCase(test, {
  id: 'C10031',
  tags: [TAGS.LOGIN, TAGS.UI],
  title: 'Login module - password field masks input',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.enterPassword('SecretPassword123!');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  },
});

testCase(test, {
  id: 'C10032',
  tags: [TAGS.LOGIN, TAGS.UI],
  title: 'Login module - remember me checkbox is interactive',
  test: async ({ loginPage }) => {
    await loginPage.open();
    const isVisible = await loginPage.rememberMeCheckbox.isVisible().catch(() => false);
    test.skip(!isVisible, 'Remember me checkbox not present on login page');
    await loginPage.toggleRememberMe();
  },
});
