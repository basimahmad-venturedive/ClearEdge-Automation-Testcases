import { testCase } from '../../../common/fixtures/testCase.js';
import { test } from '../../fixtures/apiFixtures.js';
import { validate } from '../../validators/responseValidator.js';
import { validateLoginError } from '../../schemas/loginSchema.js';
import { loginApiTestData } from '../../testdata/loginApiTestData.js';
import { HTTP_STATUS, TAGS } from '../../../common/constants/index.js';

testCase(test, {
  id: 'C20010',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.API],
  title: 'API Regression - login fails with invalid credentials',
  test: async ({ loginApi }) => {
    const credentials = loginApiTestData.invalidCredentials();
    const result = await loginApi.login(credentials.email, credentials.password);
    validate(result).assertUnauthorized();
    validateLoginError(result.body);
  },
});

testCase(test, {
  id: 'C20011',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.API],
  title: 'API Regression - login fails with missing email',
  test: async ({ loginApi }) => {
    const payload = loginApiTestData.missingEmail();
    const result = await loginApi.post('/auth/login', { data: payload });
    validate(result).assertBadRequest();
  },
});

testCase(test, {
  id: 'C20012',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.API],
  title: 'API Regression - login fails with missing password',
  test: async ({ loginApi }) => {
    const payload = loginApiTestData.missingPassword();
    const result = await loginApi.post('/auth/login', { data: payload });
    validate(result).assertBadRequest();
  },
});

testCase(test, {
  id: 'C20013',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.API],
  title: 'API Regression - login fails with empty payload',
  test: async ({ loginApi }) => {
    const result = await loginApi.post('/auth/login', { data: loginApiTestData.emptyPayload() });
    validate(result).assertBadRequest();
  },
});

testCase(test, {
  id: 'C20014',
  tags: [TAGS.REGRESSION, TAGS.LOGIN, TAGS.API],
  title: 'API Regression - auth/me rejects request without token',
  test: async ({ loginApi }) => {
    const result = await loginApi.get('/auth/me');
    validate(result).assertUnauthorized();
  },
});
