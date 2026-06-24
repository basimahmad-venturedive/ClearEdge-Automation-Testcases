import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect, attachDiagnostics } from '../../fixtures/webFixtures.js';
import { loginTestData } from '../../testdata/loginTestData.js';
import { TAGS } from '../../../common/constants/index.js';

test.beforeEach(async ({ page }) => {
  attachDiagnostics(page);
});

testCase(test, {
  id: 'C10020',
  tags: [TAGS.SANITY, TAGS.LOGIN, TAGS.UI],
  title: 'Sanity - login page URL is correct',
  test: async ({ loginPage }) => {
    await loginPage.open();
    const url = await loginPage.getCurrentUrl();
    expect(url).toContain('/login');
  },
});

testCase(test, {
  id: 'C10021',
  tags: [TAGS.SANITY, TAGS.LOGIN, TAGS.UI],
  title: 'Sanity - submit button is enabled on login page',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await expect(loginPage.submitButton).toBeEnabled();
  },
});

testCase(test, {
  id: 'C10022',
  tags: [TAGS.SANITY, TAGS.LOGIN, TAGS.UI],
  title: 'Sanity - email field accepts input',
  test: async ({ loginPage }) => {
    await loginPage.open();
    await loginPage.enterEmail('test@example.com');
    await expect(loginPage.emailInput).toHaveValue('test@example.com');
  },
});
