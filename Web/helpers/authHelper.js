import path from 'path';
import { fileURLToPath } from 'url';
import { STORAGE_PATHS } from '../../common/constants/index.js';
import { ensureDir } from '../../common/utils/fileUtil.js';
import logger, { logStep } from '../../common/logger/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.resolve(__dirname, '../../.auth');

/**
 * Authentication helper — login via UI and persist storage state.
 */
export class AuthHelper {
  constructor(page, loginPage) {
    this.page = page;
    this.loginPage = loginPage;
  }

  async loginAsValidUser() {
    const email = process.env.VALID_USER_EMAIL;
    const password = process.env.VALID_USER_PASSWORD;
    if (!email || !password) {
      throw new Error('VALID_USER_EMAIL and VALID_USER_PASSWORD must be set in .env');
    }
    logStep('Authenticate as valid user');
    await this.loginPage.open();
    await this.loginPage.login(email, password);
    await this.loginPage.waitForDashboardRedirect();
    logger.info('Valid user authenticated');
  }

  async saveStorageState(filename = STORAGE_PATHS.AUTH_STATE) {
    ensureDir(authDir);
    const statePath = path.resolve(authDir, path.basename(filename));
    await this.page.context().storageState({ path: statePath });
    logger.info(`Storage state saved: ${statePath}`);
    return statePath;
  }

  async loginAndSaveState() {
    await this.loginAsValidUser();
    return this.saveStorageState();
  }

  getStorageStatePath() {
    return path.resolve(authDir, path.basename(STORAGE_PATHS.AUTH_STATE));
  }
}
