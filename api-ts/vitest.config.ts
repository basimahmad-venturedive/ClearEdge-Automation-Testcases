import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

// Under-development specs — only skipped cases (feature/endpoint/live-env not built).
// Kept off GitHub (see automation/.gitignore) AND out of the local run so CI and
// local publish the same set. Delete a line here + in .gitignore when a feature ships.
const UNDER_DEVELOPMENT = [
  "tests/admin.test.ts",
  "tests/audit.test.ts",
  "tests/auth.forgot-refresh-logout.test.ts",
  "tests/auth.login-setpw.test.ts",
  "tests/cache.test.ts",
  "tests/rbac.test.ts",
  "tests/tenant.test.ts",
  "tests/user.test.ts",
  "tests/vendor.test.ts",
];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [...configDefaults.exclude, ...UNDER_DEVELOPMENT],
    // All specs share ONE Postgres (see envs/.env.local — the Dockerized app's DB on :5433),
    // so test files must not run in parallel or their tenant-table reads/writes race
    // (e.g. a list totalCount assertion vs another file inserting fixture tenants).
    fileParallelism: false,
    // Live (dev) tests hit real Cognito + CloudFront: an admin create is a real AdminCreateUser
    // and teardown is a real AdminDeleteUser, so a single case can take several seconds. The 5s
    // default flakes on these; 30s gives comfortable headroom (local tests finish well under it).
    testTimeout: 30000,
    hookTimeout: 30000,
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
