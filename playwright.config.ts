import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "singlepc.test.ts",
  timeout: 60_000,
  use: {
    browserName: "chromium",
    headless: false,
    video: "off",
  },
});
