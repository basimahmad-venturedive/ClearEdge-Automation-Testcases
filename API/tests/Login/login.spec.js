import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect } from '../../fixtures/apiFixtures.js';
import { validate } from '../../validators/responseValidator.js';
import { AuthManager } from '../../../common/authentication/authManager.js';
import { loginApiTestData } from '../../testdata/loginApiTestData.js';
import { HTTP_STATUS, TAGS } from '../../../common/constants/index.js';

testCase(test, {
  id: 'C20030',
  tags: [TAGS.LOGIN, TAGS.API],
  title: 'Login module API - authenticate and retrieve current user',
  test: async () => {
    const credentials = loginApiTestData.validCredentials();
    test.skip(!credentials.email || !credentials.password, 'Valid credentials not configured in .env');

    const authManager = new AuthManager();
    await authManager.init();

    const loginResult = await authManager.authenticate(credentials.email, credentials.password);
    validate(loginResult).assertStatus(HTTP_STATUS.OK);

    const token = authManager.getToken();
    expect(token).toBeTruthy();

    const meResult = await authManager.loginApi.getCurrentUser(token);
    validate(meResult).assertStatus(HTTP_STATUS.OK);

    await authManager.dispose();
  },
});

testCase(test, {
  id: 'C20031',
  tags: [TAGS.LOGIN, TAGS.API],
  title: 'Login module API - logout invalidates session',
  test: async ({ loginApi, tokenManager }) => {
    const credentials = loginApiTestData.validCredentials();
    test.skip(!credentials.email || !credentials.password, 'Valid credentials not configured in .env');

    const loginResult = await loginApi.login(credentials.email, credentials.password);
    const token = loginResult.body?.accessToken || loginResult.body?.token;
    test.skip(!token, 'No token returned from login');

    tokenManager.setTokens({ accessToken: token });
    const logoutResult = await loginApi.logout(token);
    expect([HTTP_STATUS.OK, HTTP_STATUS.NO_CONTENT]).toContain(logoutResult.status);
  },
});
