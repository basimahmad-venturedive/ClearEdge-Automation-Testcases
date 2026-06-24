import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect, attachDiagnostics } from '../../fixtures/webFixtures.js';
import { loginTestData } from '../../testdata/loginTestData.js';
import { TAGS } from '../../../common/constants/index.js';

test.beforeEach(async ({ page }) => {
  attachDiagnostics(page);
});

testCase(test, {
  id: 'C10001',
  tags: [TAGS.SMOKE, TAGS.LOGIN, TAGS.UI],
  title: 'Verify login page loads with all required elements',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  },
});

testCase(test, {
  id: 'C10002',
  tags: [TAGS.SMOKE, TAGS.LOGIN, TAGS.UI],
  title: 'Verify successful login with valid credentials',
  test: async ({ loginPage }) => {
    const { email, password } = {
      email: loginTestData.validUser.email(),
      password: loginTestData.validUser.password(),
    };
    test.skip(!email || !password, 'Valid credentials not configured in .env');

    await loginPage.open();
    await loginPage.login(email, password);
    await loginPage.waitForDashboardRedirect();
  },
});
