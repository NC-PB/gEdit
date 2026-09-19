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
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
  },
});
