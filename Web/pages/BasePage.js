import logger, { logStep } from '../../common/logger/logger.js';

/**
 * Base page — shared UI actions for all page objects.
 */
export class BasePage {
  constructor(page) {
    this.page = page;
  }

  async navigate(path = '/') {
    logStep(`Navigate to ${path}`);
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    logger.info(`Navigated to ${path}`);
  }

  async waitForVisible(locator, options = {}) {
    const { timeout } = options;
    await locator.waitFor({ state: 'visible', timeout });
  }

  async waitForHidden(locator, options = {}) {
    const { timeout } = options;
    await locator.waitFor({ state: 'hidden', timeout });
  }

  async click(locator, label = 'element') {
    logStep(`Click ${label}`);
    await this.waitForVisible(locator);
    await locator.click();
  }

  async fill(locator, value, label = 'field') {
    logStep(`Fill ${label}`);
    await this.waitForVisible(locator);
    await locator.clear();
    await locator.fill(value);
  }

  async getText(locator) {
    await this.waitForVisible(locator);
    return locator.innerText();
  }

  async isVisible(locator) {
    return locator.isVisible();
  }

  async getCurrentUrl() {
    return this.page.url();
  }

  async waitForUrl(urlPattern, options = {}) {
    await this.page.waitForURL(urlPattern, options);
  }

  async takeScreenshot(name) {
    const path = `screenshots/${name}-${Date.now()}.png`;
    await this.page.screenshot({ path, fullPage: true });
    logger.info(`Screenshot saved: ${path}`);
    return path;
  }

  async attachBrowserConsoleLogs() {
    this.page.on('console', (msg) => {
      logger.debug(`Browser console [${msg.type()}]: ${msg.text()}`);
    });
  }
}
