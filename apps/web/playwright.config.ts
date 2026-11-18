import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-results/results.json" }]],
  outputDir: "e2e-results/artifacts",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "iphone-webkit", use: { ...devices["iPhone 14"] }, grep: /방 만들기|반응형 390px/ },
  ],
  use: { screenshot: "only-on-failure", baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8000", locale: "ko-KR", timezoneId: "Asia/Seoul" },
});
