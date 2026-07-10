/**
 * Page Object — Admin Portal Login screen (US-1.1).
 * Locators: locators/login.ts (§6 placeholder contract).
 * Auth is a client-side Cognito SDK flow (SPEC §8.2) — no backend login endpoint.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { LoginLocators } from '../locators/login';
import { AppRoutes } from '../utils/routes';
import { trackRequests, type RequestCounter } from '../utils/network';

export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get emailInput(): Locator {
    return this.page.getByTestId(LoginLocators.emailInput);
  }

  get passwordInput(): Locator {
    return this.page.getByTestId(LoginLocators.passwordInput);
  }

  get passwordToggle(): Locator {
    return this.page.getByTestId(LoginLocators.passwordToggle);
  }

  get errorText(): Locator {
    return this.page.getByTestId(LoginLocators.errorText);
  }

  get loginButton(): Locator {
    return this.page.getByRole('button', { name: LoginLocators.loginButtonName });
  }

  get logoutButton(): Locator {
    return this.page.getByRole('button', { name: LoginLocators.logoutButtonName });
  }

  async goto(): Promise<void> {
    await this.page.goto(AppRoutes.login);
  }

  /** Clear-before-fill: sessions/autofill may retain values (automation-architecture §2). */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.clear();
    await this.emailInput.fill(email);
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.clear();
    await this.passwordInput.fill(password);
  }

  async submit(): Promise<void> {
    await this.loginButton.click();
  }

  async login(email: string, password: string): Promise<void> {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }

  async togglePasswordVisibility(): Promise<void> {
    await this.passwordToggle.click();
  }

  async logout(): Promise<void> {
    await this.logoutButton.click();
  }

  /**
   * Track outgoing Cognito auth calls (TC-ADMLOGIN-003: client-side validation
   * failures must not fire any auth network request). The admin Cognito pool
   * host is environment-specific; matching on "cognito" covers the AWS
   * cognito-idp / amazoncognito endpoints.
   */
  trackAuthRequests(): RequestCounter {
    return trackRequests(this.page, (request) => request.url().toLowerCase().includes('cognito'));
  }

  async expectLoginScreen(): Promise<void> {
    await expect(this.emailInput, 'email field visible').toBeVisible();
    await expect(this.passwordInput, 'password field visible').toBeVisible();
    await expect(this.loginButton, '"Log in" button visible').toBeVisible();
  }

  /** Masked = type="password" (US-1.1 AC). */
  async expectPasswordMasked(): Promise<void> {
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
  }

  async expectPasswordRevealed(): Promise<void> {
    await expect(this.passwordInput).toHaveAttribute('type', 'text');
  }

  async expectPasswordValue(value: string): Promise<void> {
    await expect(this.passwordInput).toHaveValue(value);
  }

  /** Assert the login error shows the EXACT expected copy. */
  async expectError(message: string): Promise<void> {
    await expect(this.errorText, 'login error copy').toHaveText(message);
  }

  async errorMessageText(): Promise<string> {
    return (await this.errorText.innerText()).trim();
  }

  /** User remains on (or was redirected to) the Login screen. */
  async expectOnLoginScreen(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`${AppRoutes.login}$`));
    await this.expectLoginScreen();
  }
}
