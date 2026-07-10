import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // All specs share ONE Postgres (see envs/.env.local — the Dockerized app's DB on :5433),
    // so test files must not run in parallel or their tenant-table reads/writes race
    // (e.g. a list totalCount assertion vs another file inserting fixture tenants).
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
    reporters: [
      "default",
      "junit",
      "./reporters/extentReporter.ts",
      "./reporters/testrailReporter.cjs",
      "./reporters/cqmReporter.cjs",
    ],
    outputFile: { junit: process.env.TESTRAIL_JUNIT_OUT || "../reports/api-ts-junit.xml" },
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/clients/**", "src/payloads/**", "src/schemas/**", "src/utils/**"],
      exclude: ["src/config/**", "tests/**"],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
