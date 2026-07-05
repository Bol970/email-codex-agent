import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 30000,
  expect: {
    timeout: 8000
  },
  webServer: {
    command:
      "npm run build && NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost MOCK_MODE=1 NODE_ENV=production PORT=5174 npm run start",
    url: "http://127.0.0.1:5174/api/status",
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 920 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});
