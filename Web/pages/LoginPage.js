import { BasePage } from './BasePage.js';
import { loginLocators } from '../locators/loginLocators.js';
import { ROUTES } from '../../common/constants/index.js';
import { logStep } from '../../common/logger/logger.js';
import logger from '../../common/logger/logger.js';

/**
 * Login page object — encapsulates all login UI interactions.
 */
export class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.locators = loginLocators;
  }

  get emailInput() {
    return this.page.locator(this.locators.emailInput);
  }

  get passwordInput() {
    return this.page.locator(this.locators.passwordInput);
  }

  get submitButton() {
    return this.page.locator(this.locators.submitButton);
  }

  get errorMessage() {
    return this.page.locator(this.locators.errorMessage);
  }

  get pageTitle() {
    return this.page.locator(this.locators.pageTitle);
  }

  get forgotPasswordLink() {
    return this.page.locator(this.locators.forgotPasswordLink);
  }

  get rememberMeCheckbox() {
    return this.page.locator(this.locators.rememberMeCheckbox);
  }

  async open() {
    await this.navigate(ROUTES.LOGIN);
    await this.waitForLoginPage();
  }

  async waitForLoginPage() {
    logStep('Wait for login page to load');
    await this.waitForVisible(this.emailInput);
    await this.waitForVisible(this.passwordInput);
    await this.waitForVisible(this.submitButton);
  }

  async enterEmail(email) {
    await this.fill(this.emailInput, email, 'email');
  }

  async enterPassword(password) {
    await this.fill(this.passwordInput, password, 'password');
  }

  async clickSubmit() {
    await this.click(this.submitButton, 'login submit');
  }

  async login(email, password) {
    logStep(`Login with email: ${email}`);
    await this.enterEmail(email);
    await this.enterPassword(password);
    await this.clickSubmit();
  }

  async getErrorText() {
    await this.waitForVisible(this.errorMessage);
    return this.getText(this.errorMessage);
  }

  async isErrorDisplayed() {
    return this.isVisible(this.errorMessage);
  }

  async clickForgotPassword() {
    await this.click(this.forgotPasswordLink, 'forgot password');
  }

  async toggleRememberMe() {
    await this.click(this.rememberMeCheckbox, 'remember me');
  }

  async waitForDashboardRedirect() {
    logStep('Wait for post-login redirect');
    await this.waitForUrl(/\/(dashboard|app)/, { timeout: 30000 });
    logger.info('Redirected after successful login');
  }

  async assertOnLoginPage() {
    const url = await this.getCurrentUrl();
    if (!url.includes(ROUTES.LOGIN)) {
      throw new Error(`Expected to be on login page, but URL is: ${url}`);
    }
  }
}
