import { testCase } from '../../../common/fixtures/testCase.js';
import { test, expect } from '../../fixtures/apiFixtures.js';
import { validate } from '../../validators/responseValidator.js';
import { loginApiTestData } from '../../testdata/loginApiTestData.js';
import { HTTP_STATUS, TAGS } from '../../../common/constants/index.js';

testCase(test, {
  id: 'C20020',
  tags: [TAGS.SANITY, TAGS.LOGIN, TAGS.API],
  title: 'API Sanity - login endpoint is reachable',
  test: async ({ loginApi }) => {
    const credentials = loginApiTestData.validCredentials();
    const result = await loginApi.login(credentials.email || 'test@example.com', credentials.password || 'test');
    expect([HTTP_STATUS.OK, HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.BAD_REQUEST]).toContain(result.status);
  },
});

testCase(test, {
  id: 'C20021',
  tags: [TAGS.SANITY, TAGS.LOGIN, TAGS.API],
  title: 'API Sanity - login response is JSON',
  test: async ({ loginApi }) => {
    const credentials = loginApiTestData.invalidCredentials();
    const result = await loginApi.login(credentials.email, credentials.password);
    expect(typeof result.body).toBe('object');
  },
});
