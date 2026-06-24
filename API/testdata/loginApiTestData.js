import config from '../../common/config/configManager.js';

/**
 * Login API test data.
 */
export const loginApiTestData = {
  validCredentials: () => ({
    email: config.credentials.validEmail,
    password: config.credentials.validPassword,
  }),
  invalidCredentials: () => ({
    email: config.credentials.invalidEmail,
    password: config.credentials.invalidPassword,
  }),
  missingEmail: () => ({
    password: config.credentials.validPassword,
  }),
  missingPassword: () => ({
    email: config.credentials.validEmail,
  }),
  emptyPayload: () => ({}),
};
