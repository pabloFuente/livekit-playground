import { test, expect, type ConsoleMessage } from "@playwright/test";

// This test launches the livekit-min-app page with fake media devices,
// clicks CONNECT, waits for tracks to be subscribed, then collects
// inbound-rtp stats for ~30 seconds and prints them.

const APP_URL = "http://localhost:3000";

test.use({
  // Grant camera + microphone so getUserMedia succeeds with fake devices.
  permissions: ["camera", "microphone"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("SinglePC video should decode frames", async ({ page }) => {
  const consoleLogs: string[] = [];

  // Capture every console.log from the page.
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    consoleLogs.push(text);
    // Also print to the test runner's stdout for live visibility.
    console.log(`[browser] ${text}`);
  });

  page.on("pageerror", (err) => {
    console.error(`[browser error] ${err.message}`);
  });

  // 1. Navigate to the test app.
  await page.goto(APP_URL);
  await expect(page.locator("#btn")).toBeVisible();

  // 2. Click CONNECT.
  await page.click("#btn");

  // 3. Wait for at least one video element to appear (track subscribed).
  await page.waitForSelector("video", { timeout: 15_000 });
  console.log("--- Video element(s) appeared ---");

  // 4. Wait for inbound-rtp stats to appear in console logs.
  //    The app logs them every 3 seconds. Wait up to 30s total.
  const deadline = Date.now() + 30_000;
  let lastVideoStats: Record<string, unknown> | null = null;

  while (Date.now() < deadline) {
    await page.waitForTimeout(3_000);

    // Find the latest inbound-rtp log line.
    for (const line of consoleLogs) {
      if (!line.includes("inbound-rtp stats:")) continue;
      const jsonStr = line.substring(line.indexOf("["));
      try {
        const stats: Array<Record<string, unknown>> = JSON.parse(jsonStr);
        const video = stats.find(
          (s) => s.kind === "video" && typeof s.packetsReceived === "number"
        );
        if (video) {
          lastVideoStats = video;
        }
      } catch {
        // ignore parse errors
      }
    }

    if (lastVideoStats && (lastVideoStats.framesDecoded as number) > 0) {
      console.log(
        "--- SUCCESS: framesDecoded > 0 ---",
        JSON.stringify(lastVideoStats)
      );
      break;
    }
  }

  // 5. Print final summary.
  console.log("\n=== FINAL VIDEO STATS ===");
  console.log(JSON.stringify(lastVideoStats, null, 2));

  // 6. Assert that video frames are being decoded.
  expect(lastVideoStats, "No video inbound-rtp stats received").not.toBeNull();
  expect(
    lastVideoStats!.framesDecoded as number,
    `framesDecoded should be > 0, got ${lastVideoStats!.framesDecoded}`
  ).toBeGreaterThan(0);
});
