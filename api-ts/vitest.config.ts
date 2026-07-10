import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["default", "junit", "./reporters/extentReporter.ts"],
    outputFile: { junit: "../reports/api-ts-junit.xml" },
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
