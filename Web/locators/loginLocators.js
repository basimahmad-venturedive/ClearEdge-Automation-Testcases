/**
 * Login page locators — prefer data-testid per framework standards.
 */
export const loginLocators = {
  emailInput: '[data-testid="login-email"]',
  passwordInput: '[data-testid="login-password"]',
  submitButton: '[data-testid="login-submit"]',
  forgotPasswordLink: '[data-testid="login-forgot-password"]',
  errorMessage: '[data-testid="login-error"]',
  pageTitle: '[data-testid="login-title"]',
  rememberMeCheckbox: '[data-testid="login-remember-me"]',
  loadingSpinner: '[data-testid="login-loading"]',
};
