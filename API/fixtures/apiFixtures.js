import { test as base } from '@playwright/test';
import { LoginApiService } from '../services/loginApiService.js';
import { TokenManager } from '../helpers/tokenManager.js';
import config from '../../common/config/configManager.js';

/**
 * API fixtures — inject API services into tests.
 */
export const test = base.extend({
  loginApi: async ({}, use) => {
    const service = new LoginApiService();
    await service.init();
    await use(service);
    await service.dispose();
  },
  tokenManager: async ({}, use) => {
    const manager = new TokenManager();
    await use(manager);
    manager.clear();
  },
  config: async ({}, use) => {
    await use(config);
  },
});

export { expect } from '@playwright/test';
