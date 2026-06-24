import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const ENV = process.env.ENV || 'qa';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const HEADLESS = process.env.HEADLESS !== 'false';
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000', 10);
const RETRY_COUNT = parseInt(process.env.RETRY_COUNT || '1', 10);

export default defineConfig({
  testDir: '.',
  testMatch: ['Web/tests/**/*.spec.js', 'API/tests/**/*.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? RETRY_COUNT : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: TIMEOUT,
  expect: { timeout: 10000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright', open: 'never' }],
    ['./common/reporters/extentReporter.js'],
    ['./common/reporters/testrailReporter.js'],
  ],
  use: {
    baseURL: BASE_URL,
    headless: HEADLESS,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: TIMEOUT,
    navigationTimeout: TIMEOUT,
    launchOptions: {
      slowMo: parseInt(process.env.SLOW_MO || '0', 10),
    },
  },
  projects: [
    {
      name: 'web-chromium',
      testDir: './Web/tests',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
      },
    },
    {
      name: 'web-firefox',
      testDir: './Web/tests',
      use: {
        ...devices['Desktop Firefox'],
        baseURL: BASE_URL,
      },
    },
    {
      name: 'web-webkit',
      testDir: './Web/tests',
      use: {
        ...devices['Desktop Safari'],
        baseURL: BASE_URL,
      },
    },
    {
      name: 'api',
      testDir: './API/tests',
      use: {
        baseURL: API_BASE_URL,
      },
    },
  ],
  metadata: {
    environment: ENV,
    baseUrl: BASE_URL,
    apiBaseUrl: API_BASE_URL,
  },
});
