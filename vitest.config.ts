import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Mirror the tsconfig `@/*` -> project-root path alias so tests can import
  // modules the same way the app does.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Playwright owns e2e/; vitest's default glob would otherwise pick up *.spec.ts there.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
