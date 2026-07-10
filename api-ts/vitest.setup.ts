import dotenv from "dotenv";
import path from "path";

// TEST_ENV selects automation/api-ts/envs/.env.<local|qa|prod> — defaults to local.
const targetEnv = process.env.TEST_ENV ?? "local";
dotenv.config({ path: path.resolve(__dirname, `envs/.env.${targetEnv}`) });
// eslint-disable-next-line no-console
console.log(`[vitest.setup] Loaded environment: ${targetEnv}`);
