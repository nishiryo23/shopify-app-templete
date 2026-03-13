import { test } from "@playwright/test";

import { expectEmbeddedAppSurface, requiredEnv } from "./helpers.mjs";

if (process.env.SMOKE_STORAGE_STATE_PATH) {
  test.use({ storageState: process.env.SMOKE_STORAGE_STATE_PATH });
}

test.describe("preview shell smoke", () => {
  test("preview shell loads /app/preview", async ({ page }) => {
    test.skip(!process.env.SMOKE_PREVIEW_URL, "Set SMOKE_PREVIEW_URL for dev-store smoke.");
    const requestedUrl = requiredEnv("SMOKE_PREVIEW_URL");

    await expectEmbeddedAppSurface({
      page,
      requestedUrl,
      expectedPathname: "/app/preview",
      shellTestId: "preview-shell",
    });
  });
});
