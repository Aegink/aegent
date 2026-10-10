import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "plugins/**/*.test.ts", "src/**/*.bench.ts", "ui/**/*.test.js"],
  },
});
