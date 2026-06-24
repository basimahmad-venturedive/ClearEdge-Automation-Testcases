import logger from '../../common/logger/logger.js';
import { writeJsonFile } from '../../common/utils/fileUtil.js';
import path from 'path';

/**
 * Token manager — stores and retrieves auth tokens between API calls.
 */
export class TokenManager {
  constructor() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  setTokens({ accessToken, refreshToken, expiresIn }) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (expiresIn) {
      this.expiresAt = Date.now() + expiresIn * 1000;
    }
    logger.info('Tokens stored in TokenManager');
  }

  getAccessToken() {
    if (this.isExpired()) {
      logger.warn('Access token has expired');
      return null;
    }
    return this.accessToken;
  }

  getRefreshToken() {
    return this.refreshToken;
  }

  isExpired() {
    return this.expiresAt && Date.now() >= this.expiresAt;
  }

  clear() {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  saveToFile(filePath = '.auth/tokens.json') {
    writeJsonFile(path.resolve(filePath), {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
    });
  }
}
