import { test, expect } from "@playwright/test";

import { requiredEnv } from "./helpers.mjs";

test.describe("install and reinstall smoke", () => {
  test("install flow entry is reachable", async ({ page }) => {
    test.skip(!process.env.SMOKE_INSTALL_URL, "Set SMOKE_INSTALL_URL for dev-store smoke.");

    const requestedUrl = requiredEnv("SMOKE_INSTALL_URL");
    await page.goto(requestedUrl);
    await expect(page).not.toHaveURL("about:blank");
    await expect(page.getByTestId("install-entry")).toBeVisible();
  });

  test("reinstall flow entry is reachable", async ({ page }) => {
    test.skip(!process.env.SMOKE_REINSTALL_URL, "Set SMOKE_REINSTALL_URL for dev-store smoke.");

    const requestedUrl = requiredEnv("SMOKE_REINSTALL_URL");
    await page.goto(requestedUrl);
    await expect(page).not.toHaveURL("about:blank");
    await expect(page.getByTestId("reinstall-entry")).toBeVisible();
  });
});
