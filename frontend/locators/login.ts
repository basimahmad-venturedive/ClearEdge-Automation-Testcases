/**
 * Login screen selectors — VERIFIED against the live dev admin portal
 * (https://d1u0bc7op5aqi4.cloudfront.net/login) on 2026-07-14.
 *
 * The deployed app is an Ant Design (antd) SPA. It exposes NO data-testid
 * attributes, so the §6 placeholder testid contract does not apply here; these
 * are the real, stable selectors observed on the page:
 *   - email / password are antd inputs with stable ids (#email, #password)
 *   - the reveal control is antd's Input.Password icon (role=button "Show"/"Hide")
 *   - validation errors render per-field in `.ant-form-item-explain-error`
 *   - the submit button's accessible name is "Log in"
 */
export const LoginLocators = {
  /** antd Input id — email field. */
  emailInput: '#email',
  /** antd Input.Password id — password field. */
  passwordInput: '#password',
  /** antd Input.Password reveal icon (toggles type password<->text). */
  passwordToggle: '.ant-input-password-icon',
  /** Invalid-credentials alert — data-testid="login-error" (added to clearedge-admin). */
  loginError: 'login-error',
  /** role=button[name="Log in"] */
  loginButtonName: 'Log in',
  /** role=button[name="Logout"] — real name TBD (post-login screen not yet verified). */
  logoutButtonName: 'Logout',
} as const;
