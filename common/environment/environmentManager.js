import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Environment manager — resolves runtime environment configuration.
 */
class EnvironmentManager {
  constructor() {
    this.env = process.env.ENV || 'qa';
    this.baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
    this.headless = process.env.HEADLESS !== 'false';
    this.timeout = parseInt(process.env.TIMEOUT || '30000', 10);
    this.retryCount = parseInt(process.env.RETRY_COUNT || '1', 10);
    this.enableExtent = process.env.ENABLE_EXTENT !== 'false';
    this.enableTestRail = process.env.ENABLE_TESTRAIL === 'true';
  }

  getEnv() {
    return this.env;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getApiBaseUrl() {
    return this.apiBaseUrl;
  }

  isHeadless() {
    return this.headless;
  }

  getTimeout() {
    return this.timeout;
  }

  getRetryCount() {
    return this.retryCount;
  }

  isExtentEnabled() {
    return this.enableExtent;
  }

  isTestRailEnabled() {
    return this.enableTestRail;
  }

  getCredentials() {
    return {
      validEmail: process.env.VALID_USER_EMAIL || '',
      validPassword: process.env.VALID_USER_PASSWORD || '',
      invalidEmail: process.env.INVALID_USER_EMAIL || 'invalid@example.com',
      invalidPassword: process.env.INVALID_USER_PASSWORD || 'WrongPassword123!',
    };
  }

  getTestRailConfig() {
    return {
      url: process.env.TESTRAIL_URL || '',
      username: process.env.TESTRAIL_USERNAME || '',
      apiKey: process.env.TESTRAIL_API_KEY || '',
      projectId: process.env.TESTRAIL_PROJECT_ID || '',
      suiteId: process.env.TESTRAIL_SUITE_ID || '',
    };
  }
}

const environment = new EnvironmentManager();
export default environment;
