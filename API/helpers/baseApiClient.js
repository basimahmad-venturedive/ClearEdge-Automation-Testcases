import { request as playwrightRequest } from '@playwright/test';
import config from '../../common/config/configManager.js';
import logger, { logApiRequest, logApiResponse } from '../../common/logger/logger.js';
import { retry } from '../../common/retry/retryUtil.js';

/**
 * Base API client using Playwright APIRequestContext.
 */
export class BaseApiClient {
  constructor(baseURL) {
    this.baseURL = baseURL || config.apiBaseUrl;
    this.context = null;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    this.authToken = null;
  }

  async init() {
    this.context = await playwrightRequest.newContext({
      baseURL: this.baseURL,
      extraHTTPHeaders: this.defaultHeaders,
    });
    logger.info(`API client initialized: ${this.baseURL}`);
    return this;
  }

  setAuthToken(token) {
    this.authToken = token;
    this.defaultHeaders.Authorization = `Bearer ${token}`;
  }

  getHeaders(extra = {}) {
    return { ...this.defaultHeaders, ...extra };
  }

  async get(endpoint, options = {}) {
    return this._request('GET', endpoint, options);
  }

  async post(endpoint, options = {}) {
    return this._request('POST', endpoint, options);
  }

  async put(endpoint, options = {}) {
    return this._request('PUT', endpoint, options);
  }

  async patch(endpoint, options = {}) {
    return this._request('PATCH', endpoint, options);
  }

  async delete(endpoint, options = {}) {
    return this._request('DELETE', endpoint, options);
  }

  async _request(method, endpoint, options = {}) {
    if (!this.context) await this.init();

    const { data, headers = {}, params, retry: retryOptions } = options;
    let url = endpoint;

    if (params) {
      const query = new URLSearchParams(params).toString();
      url = `${endpoint}?${query}`;
    }

    const requestOptions = {
      headers: this.getHeaders(headers),
      ...(data !== undefined && { data }),
    };

    logApiRequest(method, url, data);

    const execute = async () => {
      const response = await this.context[method.toLowerCase()](url, requestOptions);
      let body;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      logApiResponse(response.status(), url, body);
      return { response, body, status: response.status() };
    };

    if (retryOptions) {
      return retry(execute, { label: `${method} ${url}`, ...retryOptions });
    }

    return execute();
  }

  async dispose() {
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
  }
}
