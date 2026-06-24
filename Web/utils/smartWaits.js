import logger from '../../common/logger/logger.js';

/**
 * Smart waits — no hard waits; use Playwright auto-waiting.
 */
export const waitForNetworkIdle = async (page, timeout = 10000) => {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    logger.debug('Network idle timeout — continuing');
  }
};

export const waitForElementStable = async (locator) => {
  await locator.waitFor({ state: 'visible' });
  await locator.waitFor({ state: 'attached' });
};

export const waitForApiResponse = async (page, urlPattern, options = {}) => {
  const { method = 'POST', timeout = 30000 } = options;
  return page.waitForResponse(
    (response) =>
      (typeof urlPattern === 'string' ? response.url().includes(urlPattern) : urlPattern.test(response.url())) &&
      response.request().method() === method,
    { timeout }
  );
};

export const waitForSpinnerToDisappear = async (page, spinnerSelector) => {
  const spinner = page.locator(spinnerSelector);
  if (await spinner.isVisible().catch(() => false)) {
    await spinner.waitFor({ state: 'hidden' });
  }
};
