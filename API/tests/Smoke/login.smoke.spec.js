import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect } from '../../fixtures/apiFixtures.js';
import { validate } from '../../validators/responseValidator.js';
import { validateLoginSuccess } from '../../schemas/loginSchema.js';
import { loginApiTestData } from '../../testdata/loginApiTestData.js';
import { HTTP_STATUS, TAGS } from '../../../common/constants/index.js';

testCase(test, {
  id: 'C20001',
  tags: [TAGS.SMOKE, TAGS.LOGIN, TAGS.API],
  title: 'API Smoke - successful login returns access token',
  test: async ({ loginApi }) => {
    const credentials = loginApiTestData.validCredentials();
    test.skip(!credentials.email || !credentials.password, 'Valid credentials not configured in .env');

    const result = await loginApi.login(credentials.email, credentials.password);
    validate(result).assertStatus(HTTP_STATUS.OK);
    validateLoginSuccess(result.body);
    const token = validate(result).getToken();
    expect(token).toBeTruthy();
  },
});

testCase(test, {
  id: 'C20002',
  tags: [TAGS.SMOKE, TAGS.LOGIN, TAGS.API],
  title: 'API Smoke - auth/me returns user profile with valid token',
  test: async ({ loginApi, tokenManager }) => {
    const credentials = loginApiTestData.validCredentials();
    test.skip(!credentials.email || !credentials.password, 'Valid credentials not configured in .env');

    const loginResult = await loginApi.login(credentials.email, credentials.password);
    const token = loginResult.body?.accessToken || loginResult.body?.token;
    test.skip(!token, 'No token returned from login');

    tokenManager.setTokens({ accessToken: token });
    const meResult = await loginApi.getCurrentUser(token);
    validate(meResult).assertStatus(HTTP_STATUS.OK);
    validate(meResult).assertBodyHasProperty('email');
  },
});
