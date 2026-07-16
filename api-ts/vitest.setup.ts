import dotenv from "dotenv";
import path from "path";
import { afterEach } from "vitest";
import { installApiCapture, drainApiCalls } from "./src/utils/apiCapture";

// TEST_ENV selects automation/api-ts/envs/.env.<local|qa|prod> — defaults to local.
const targetEnv = process.env.TEST_ENV ?? "local";
// override:true — the selected env file is authoritative for the test workers, so
// values already in process.env (e.g. CQM's AWS_REGION=us-east-2 loaded by
// config/env.cjs from api-ts/.env, or empty Jenkins build params) don't shadow it.
// CQM runs in the reporter (main process), which this setup file does not touch.
dotenv.config({ path: path.resolve(__dirname, `envs/.env.${targetEnv}`), override: true });
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
