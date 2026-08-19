import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // The browser suite under e2e/ is driven by Playwright, which brings its
    // own runner. Without this, vitest collects those files and fails on them.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
