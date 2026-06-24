import { ensureDir } from '../../common/utils/fileUtil.js';
import logger from '../../common/logger/logger.js';
import path from 'path';

/**
 * Screenshot utility for test artifacts.
 */
export const captureScreenshot = async (page, name, folder = 'screenshots') => {
  ensureDir(folder);
  const filePath = path.join(folder, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  logger.info(`Screenshot captured: ${filePath}`);
  return filePath;
};

export const captureOnFailure = async (page, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const screenshot = await captureScreenshot(page, `failure-${testInfo.title.replace(/\s+/g, '-')}`);
    await testInfo.attach('failure-screenshot', { path: screenshot, contentType: 'image/png' });
  }
};
