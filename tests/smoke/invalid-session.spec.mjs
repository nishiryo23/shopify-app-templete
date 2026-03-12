import { test, expect } from "@playwright/test";

import { expectRetryHeader, requiredEnv } from "./helpers.mjs";

test.describe("invalid session smoke", () => {
  test("invalid XHR returns 401 with retry header", async ({ request }) => {
    test.skip(!process.env.SMOKE_INVALID_SESSION_XHR_URL, "Set SMOKE_INVALID_SESSION_XHR_URL for dev-store smoke.");

    const invalidSessionUrl = requiredEnv("SMOKE_INVALID_SESSION_XHR_URL");
    const response = await request.get(invalidSessionUrl, {
      headers: {
        Authorization: "Bearer invalid-session-token",
      },
    });

    await expectRetryHeader(response);
  });

  if (process.env.SMOKE_STORAGE_STATE_PATH) {
    test.use({ storageState: process.env.SMOKE_STORAGE_STATE_PATH });
  }

  test("invalid document request bounces", async ({ page }) => {
    test.skip(!process.env.SMOKE_INVALID_SESSION_DOCUMENT_URL, "Set SMOKE_INVALID_SESSION_DOCUMENT_URL for dev-store smoke.");

    const requestedUrl = requiredEnv("SMOKE_INVALID_SESSION_DOCUMENT_URL");
    await page.goto(requestedUrl);
    await page.waitForURL(
      (url) =>
        url.toString() !== requestedUrl &&
        /\/auth|\/login|\/install/.test(`${url.pathname}${url.search}`),
    );
    await expect(page).not.toHaveURL(requestedUrl);
  });
});
