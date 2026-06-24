import { API_ENDPOINTS } from '../../common/constants/index.js';
import { BaseApiClient } from '../helpers/baseApiClient.js';
import { buildLoginPayload } from '../payloads/loginPayload.js';

/**
 * Login API service — auth endpoint interactions.
 */
export class LoginApiService extends BaseApiClient {
  async login(email, password) {
    const payload = buildLoginPayload(email, password);
    return this.post(API_ENDPOINTS.AUTH_LOGIN, { data: payload });
  }

  async logout(token) {
    return this.post(API_ENDPOINTS.AUTH_LOGOUT, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async refreshToken(refreshToken) {
    return this.post(API_ENDPOINTS.AUTH_REFRESH, {
      data: { refreshToken },
    });
  }

  async getCurrentUser(token) {
    return this.get(API_ENDPOINTS.AUTH_ME, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
