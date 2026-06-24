import path from 'path';
import { fileURLToPath } from 'url';
import { fileExists } from '../../common/utils/fileUtil.js';
import { STORAGE_PATHS } from '../../common/constants/index.js';
import logger from '../../common/logger/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.resolve(__dirname, '../../.auth');

/**
 * Session manager — manages authenticated browser sessions.
 */
export class SessionManager {
  static getAuthStatePath() {
    return path.resolve(authDir, path.basename(STORAGE_PATHS.AUTH_STATE));
  }

  static hasStoredSession() {
    return fileExists(SessionManager.getAuthStatePath());
  }

  static getStorageState() {
    const statePath = SessionManager.getAuthStatePath();
    if (!fileExists(statePath)) {
      logger.warn('No stored session found');
      return undefined;
    }
    return statePath;
  }

  static async clearSession() {
    const fs = await import('fs');
    const statePath = SessionManager.getAuthStatePath();
    if (fileExists(statePath)) {
      fs.unlinkSync(statePath);
      logger.info('Session cleared');
    }
  }
}
