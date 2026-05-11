import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./"),
    },
  },
});
