import { chromium, firefox, webkit } from '@playwright/test';
import config from '../../common/config/configManager.js';
import logger from '../../common/logger/logger.js';

const BROWSERS = { chromium, firefox, webkit };

/**
 * Browser manager — launches and manages browser instances.
 */
export class BrowserManager {
  constructor(browserType = 'chromium') {
    this.browserType = browserType;
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async launch(options = {}) {
    const launcher = BROWSERS[this.browserType] || chromium;
    this.browser = await launcher.launch({
      headless: config.env ? config.baseUrl && process.env.HEADLESS !== 'false' : true,
      slowMo: parseInt(process.env.SLOW_MO || '0', 10),
      ...options,
    });
    logger.info(`Browser launched: ${this.browserType}`);
    return this.browser;
  }

  async createContext(storageState) {
    if (!this.browser) await this.launch();
    this.context = await this.browser.newContext({
      baseURL: config.baseUrl,
      storageState: storageState || undefined,
      recordVideo: { dir: 'videos/' },
    });
    this.page = await this.context.newPage();
    return { context: this.context, page: this.page };
  }

  async close() {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    logger.info('Browser closed');
  }

  getPage() {
    return this.page;
  }
}
