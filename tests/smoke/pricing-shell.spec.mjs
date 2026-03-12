import { test } from "@playwright/test";

import { expectEmbeddedAppSurface, requiredEnv } from "./helpers.mjs";

if (process.env.SMOKE_STORAGE_STATE_PATH) {
  test.use({ storageState: process.env.SMOKE_STORAGE_STATE_PATH });
}

test.describe("pricing shell smoke", () => {
  test("pricing shell loads /app/pricing", async ({ page }) => {
    test.skip(!process.env.SMOKE_PRICING_URL, "Set SMOKE_PRICING_URL for dev-store smoke.");
    const requestedUrl = requiredEnv("SMOKE_PRICING_URL");

    await expectEmbeddedAppSurface({
      page,
      requestedUrl,
      expectedPathname: "/app/pricing",
      shellTestId: "pricing-shell",
    });
  });
});
