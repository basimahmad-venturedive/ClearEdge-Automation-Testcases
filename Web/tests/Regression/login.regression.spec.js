import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect, attachDiagnostics } from '../../fixtures/webFixtures.js';
import { loginTestData } from '../../testdata/loginTestData.js';
import { TAGS } from '../../../common/constants/index.js';

test.beforeEach(async ({ page }) => {
  attachDiagnostics(page);
});

testCase(test, {
  id: 'C10010',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.UI],
  title: 'Verify error message on invalid credentials',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.login(
      loginTestData.invalidUser.email(),
      loginTestData.invalidUser.password()
    );
    await expect(loginPage.errorMessage).toBeVisible();
    const errorText = await loginPage.getErrorText();
    expect(errorText).toMatch(loginTestData.messages.invalidCredentials);
  },
});

testCase(test, {
  id: 'C10011',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.UI],
  title: 'Verify login fails with empty email and password',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.clickSubmit();
    await loginPage.assertOnLoginPage();
    const url = await loginPage.getCurrentUrl();
    expect(url).toContain('/login');
  },
});

testCase(test, {
  id: 'C10012',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.UI],
  title: 'Verify login fails with invalid email format',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.login(
      loginTestData.invalidEmailFormat.email,
      loginTestData.invalidEmailFormat.password
    );
    await loginPage.assertOnLoginPage();
  },
});

testCase(test, {
  id: 'C10013',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.UI],
  title: 'Verify forgot password link is visible',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await expect(loginPage.forgotPasswordLink).toBeVisible();
  },
});

testCase(test, {
  id: 'C10014',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.UI],
  title: 'Verify user remains on login page after failed attempt',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.login(
      loginTestData.invalidUser.email(),
      loginTestData.invalidUser.password()
    );
    await loginPage.assertOnLoginPage();
  },
});
