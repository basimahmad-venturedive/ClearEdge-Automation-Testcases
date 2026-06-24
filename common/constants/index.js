/**
 * Centralized application constants.
 */

export const MODULES = {
  LOGIN: 'Login',
};

export const TEST_TYPES = {
  SMOKE: 'Smoke',
  REGRESSION: 'Regression',
  SANITY: 'Sanity',
};

export const TAGS = {
  SMOKE: '@Smoke',
  REGRESSION: '@Regression',
  SANITY: '@Sanity',
  LOGIN: '@Login',
  UI: '@UI',
  API: '@API',
};

export const ROUTES = {
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
};

export const API_ENDPOINTS = {
  AUTH_LOGIN: '/auth/login',
  AUTH_LOGOUT: '/auth/logout',
  AUTH_REFRESH: '/auth/refresh',
  AUTH_ME: '/auth/me',
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
  INTERNAL_SERVER_ERROR: 500,
};

export const STORAGE_PATHS = {
  AUTH_STATE: '.auth/user.json',
};

export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
};

export const TESTRAIL_STATUS = {
  PASSED: 1,
  FAILED: 5,
  UNTESTED: 3,
  BLOCKED: 2,
};
