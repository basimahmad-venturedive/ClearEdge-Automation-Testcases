import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import config from '../../common/config/configManager.js';
import logger from '../../common/logger/logger.js';

/**
 * Web fixtures — inject page objects into tests.
 */
export const test = base.extend({
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await use(loginPage);
  },
  config: async ({}, use) => {
    await use(config);
  },
});

export { expect } from '@playwright/test';

/**
 * Attach browser console and network logging to every test.
 */
export const attachDiagnostics = (page) => {
  page.on('console', (msg) => {
    logger.debug(`Browser [${msg.type()}]: ${msg.text()}`);
  });
  page.on('response', (response) => {
    if (response.url().includes('/auth') || response.url().includes('/login')) {
      logger.debug(`Network: ${response.request().method()} ${response.url()} -> ${response.status()}`);
    }
  });
};
