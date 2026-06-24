import config from '../../common/config/configManager.js';

/**
 * Login test data — credentials sourced from environment.
 */
export const loginTestData = {
  validUser: {
    email: () => config.credentials.validEmail,
    password: () => config.credentials.validPassword,
  },
  invalidUser: {
    email: () => config.credentials.invalidEmail,
    password: () => config.credentials.invalidPassword,
  },
  emptyCredentials: {
    email: '',
    password: '',
  },
  invalidEmailFormat: {
    email: 'not-an-email',
    password: 'SomePassword123!',
  },
  messages: {
    invalidCredentials: /invalid|incorrect|unauthorized/i,
    requiredEmail: /email.*required/i,
    requiredPassword: /password.*required/i,
    invalidEmail: /valid email/i,
  },
};
