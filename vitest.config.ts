import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns e2e/; vitest's default glob would otherwise pick up *.spec.ts there.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
