import dotenv from "dotenv";
import path from "path";
import { afterEach } from "vitest";
import { installApiCapture, drainApiCalls } from "./src/utils/apiCapture";

// TEST_ENV selects automation/api-ts/envs/.env.<local|qa|prod> — defaults to local.
const targetEnv = process.env.TEST_ENV ?? "local";
dotenv.config({ path: path.resolve(__dirname, `envs/.env.${targetEnv}`) });
// eslint-disable-next-line no-console
console.log(`[vitest.setup] Loaded environment: ${targetEnv}`);

// Capture every axios request/response so the ExtentReporter can render
// request/response headers + bodies per test. Tests run non-parallel
// (vitest.config.ts fileParallelism:false), so the shared buffer maps cleanly
// to one test at a time — afterEach hands the current test's calls to task.meta.
installApiCapture();
afterEach((ctx) => {
  const calls = drainApiCalls();
  if (calls.length > 0) {
    (ctx.task.meta as { apiCalls?: unknown }).apiCalls = calls;
  }
});
