import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import pkg from "./package.json" with { type: "json" };

// Unit tests run in node: pure core modules, stores and services with fakes.
// Monaco and the Tauri runtime are never imported here.
export default defineConfig({
  plugins: [sveltekit()],
  // Same compile-time constants as vite.config.js
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    // The default 5 s is a wall-clock limit too: the bulk tests (300k lines) and the fixture
    // reads take 1 to 3 s on a loaded machine, so the limit sits well above the budgets they assert.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
