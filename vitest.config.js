import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({ jsxRuntime: "automatic" })],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    clearMocks: true,
    restoreMocks: true,
  },
});
