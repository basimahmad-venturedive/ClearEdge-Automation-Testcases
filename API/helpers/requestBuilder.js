/**
 * Request builder for constructing API payloads and query params.
 */
export class RequestBuilder {
  constructor() {
    this._body = {};
    this._headers = {};
    this._params = {};
  }

  withBody(body) {
    this._body = { ...this._body, ...body };
    return this;
  }

  withHeader(key, value) {
    this._headers[key] = value;
    return this;
  }

  withParam(key, value) {
    this._params[key] = value;
    return this;
  }

  withBearerToken(token) {
    return this.withHeader('Authorization', `Bearer ${token}`);
  }

  build() {
    return {
      data: Object.keys(this._body).length ? this._body : undefined,
      headers: Object.keys(this._headers).length ? this._headers : undefined,
      params: Object.keys(this._params).length ? this._params : undefined,
    };
  }
}

export const buildRequest = () => new RequestBuilder();
