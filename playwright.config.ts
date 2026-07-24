import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    // Port 3100 keeps the e2e server clear of a locally running `next dev`.
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100/dashboard-preview",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_PRIVY_APP_ID: "",
      NEXT_PUBLIC_PRIVY_CLIENT_ID: "",
    },
  },
});
