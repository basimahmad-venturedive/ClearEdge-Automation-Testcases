/**
 * PLACEHOLDER selector contract — testcases/TC-CEIQ-FEAT-001.md §6.
 *
 * The admin portal frontend is not yet built; the spec defines no data-testid
 * attributes. Every selector below is the PROPOSED contract pending
 * confirmation by the frontend team (analogous to the kit's TODO_LOCATOR
 * policy). Playwright specs must not merge to a live pipeline until the real
 * attributes exist or role/name fallbacks are verified.
 *
 * Convention: values without a `Name` suffix are `data-testid` values (use
 * `page.getByTestId`); values with a `Name` suffix are accessible names for
 * `page.getByRole('button', { name })`.
 */
export const LoginLocators = {
  /** §6: data-testid="login-email" */
  emailInput: 'login-email',
  /** §6: data-testid="login-password" */
  passwordInput: 'login-password',
  /** §6: data-testid="login-password-toggle" (eye icon) */
  passwordToggle: 'login-password-toggle',
  /** §6: data-testid="login-error" */
  errorText: 'login-error',
  /** §6: role=button[name="Log in"] */
  loginButtonName: 'Log in',
  /** §6: role=button[name="Logout"] */
  logoutButtonName: 'Logout',
} as const;
