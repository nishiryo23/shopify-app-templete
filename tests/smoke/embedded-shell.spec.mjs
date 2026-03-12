import { test, expect } from "@playwright/test";

import { expectEmbeddedAppSurface, requiredEnv } from "./helpers.mjs";

if (process.env.SMOKE_STORAGE_STATE_PATH) {
  test.use({ storageState: process.env.SMOKE_STORAGE_STATE_PATH });
}

test.describe("embedded shell smoke", () => {
  test("embedded shell loads /app without fatal UI failure", async ({ page }) => {
    test.skip(!process.env.SMOKE_EMBEDDED_APP_URL, "Set SMOKE_EMBEDDED_APP_URL for dev-store smoke.");
    const requestedUrl = requiredEnv("SMOKE_EMBEDDED_APP_URL");

    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await expectEmbeddedAppSurface({
      page,
      requestedUrl,
      expectedPathname: "/app",
      shellTestId: "app-shell",
    });
    expect(errors).toEqual([]);
  });
});
