import { HTTP_STATUS } from '../../common/constants/index.js';
import logger from '../../common/logger/logger.js';

/**
 * Response validator for API assertions.
 */
export class ResponseValidator {
  constructor(result) {
    this.result = result;
    this.status = result.status;
    this.body = result.body;
  }

  assertStatus(expectedStatus) {
    if (this.status !== expectedStatus) {
      throw new Error(`Expected status ${expectedStatus}, got ${this.status}. Body: ${JSON.stringify(this.body)}`);
    }
    logger.debug(`Status assertion passed: ${expectedStatus}`);
    return this;
  }

  assertOk() {
    return this.assertStatus(HTTP_STATUS.OK);
  }

  assertUnauthorized() {
    return this.assertStatus(HTTP_STATUS.UNAUTHORIZED);
  }

  assertBadRequest() {
    return this.assertStatus(HTTP_STATUS.BAD_REQUEST);
  }

  assertBodyHasProperty(property) {
    if (!this.body || this.body[property] === undefined) {
      throw new Error(`Expected body to have property "${property}". Body: ${JSON.stringify(this.body)}`);
    }
    return this;
  }

  assertBodyPropertyEquals(property, expected) {
    this.assertBodyHasProperty(property);
    if (this.body[property] !== expected) {
      throw new Error(`Expected ${property}="${expected}", got "${this.body[property]}"`);
    }
    return this;
  }

  assertBodyContains(text) {
    const bodyStr = JSON.stringify(this.body);
    if (!bodyStr.toLowerCase().includes(text.toLowerCase())) {
      throw new Error(`Expected body to contain "${text}". Body: ${bodyStr}`);
    }
    return this;
  }

  getBody() {
    return this.body;
  }

  getToken() {
    return this.body?.accessToken || this.body?.token || this.body?.access_token;
  }
}

export const validate = (result) => new ResponseValidator(result);
