/**
 * Page Object — ClearEdge main (tenant-facing) app login. Distinct from the
 * admin portal LoginPage: this drives APP_BASE_URL with the tenant Cognito pool
 * (Procurement Owner). Uses the app's real `auth-login-*` data-testids.
 */
import { expect, type Page } from '@playwright/test';
import { appBaseUrl, poEmail, poPassword } from '../utils/env';

export class AppLoginPage {
  constructor(readonly page: Page) {}

  private appUrl(path: string): string {
    return `${appBaseUrl().replace(/\/$/, '')}${path}`;
  }

  async goto(): Promise<void> {
    await this.page.goto(this.appUrl('/login'));
    await expect(this.page.getByTestId('auth-login-view')).toBeVisible();
  }

  async login(email: string, password: string): Promise<void> {
    await this.page.getByTestId('auth-login-email').fill(email);
    await this.page.getByTestId('auth-login-password').fill(password);
    await this.page.getByTestId('auth-login-submit').click();
    // Success = navigated away from /login (app redirects to its landing page).
    await this.page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30000 });
  }

  /** Log in as the dev Procurement Owner (PO_EMAIL / PO_PASSWORD from .env.dev). */
  async loginAsPO(): Promise<void> {
    await this.goto();
    await this.login(poEmail(), poPassword());
  }
}
