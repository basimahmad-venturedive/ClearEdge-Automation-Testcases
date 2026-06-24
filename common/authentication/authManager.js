import { LoginApiService } from '../../API/services/loginApiService.js';
import { TokenManager } from '../../API/helpers/tokenManager.js';
import logger, { logStep } from '../logger/logger.js';

/**
 * API authentication manager — handles token-based auth for API tests.
 */
export class AuthManager {
  constructor() {
    this.loginApi = new LoginApiService();
    this.tokenManager = new TokenManager();
  }

  async init() {
    await this.loginApi.init();
    return this;
  }

  async authenticate(email, password) {
    logStep(`API authenticate: ${email}`);
    const result = await this.loginApi.login(email, password);
    const token = result.body?.accessToken || result.body?.token;
    if (token) {
      this.tokenManager.setTokens({
        accessToken: token,
        refreshToken: result.body?.refreshToken,
        expiresIn: result.body?.expiresIn,
      });
      this.loginApi.setAuthToken(token);
      logger.info('API authentication successful');
    }
    return result;
  }

  getToken() {
    return this.tokenManager.getAccessToken();
  }

  async dispose() {
    await this.loginApi.dispose();
    this.tokenManager.clear();
  }
}
