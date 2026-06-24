import logger from '../../common/logger/logger.js';

/**
 * Network interceptor — mock or monitor API calls during UI tests.
 */
export class NetworkInterceptor {
  constructor(page) {
    this.page = page;
    this.routes = [];
  }

  async mockResponse(urlPattern, responseBody, status = 200) {
    await this.page.route(urlPattern, async (route) => {
      logger.debug(`Mocking response for: ${route.request().url()}`);
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(responseBody),
      });
    });
    this.routes.push(urlPattern);
  }

  async interceptRequest(urlPattern, handler) {
    await this.page.route(urlPattern, handler);
    this.routes.push(urlPattern);
  }

  async unrouteAll() {
    for (const pattern of this.routes) {
      await this.page.unroute(pattern);
    }
    this.routes = [];
  }
}
