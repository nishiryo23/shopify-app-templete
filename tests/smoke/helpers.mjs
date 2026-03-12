import { expect } from "@playwright/test";

const EMBEDDED_APP_SURFACE_TIMEOUT_MS = 15_000;
const EMBEDDED_APP_SURFACE_POLL_INTERVAL_MS = 200;

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required smoke env: ${name}`);
  }

  return value;
}

export async function expectRetryHeader(response) {
  await expect(response).not.toBeNull();
  await expect(response.status()).toBe(401);
  await expect(response.headers()["x-shopify-retry-invalid-session-request"]).toBe("1");
}

function getPathname(url) {
  try {
    return normalizePathname(new URL(url).pathname);
  } catch {
    return null;
  }
}

function normalizePathname(pathname) {
  if (!pathname || pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

function findEmbeddedAppFrame(page, expectedPathname) {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }

    if (getPathname(frame.url()) === expectedPathname) {
      return frame;
    }
  }

  return null;
}

async function isShellVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

export async function detectEmbeddedAppSurface({
  page,
  expectedPathname,
  shellTestId,
  timeoutMs = EMBEDDED_APP_SURFACE_TIMEOUT_MS,
  pollIntervalMs = EMBEDDED_APP_SURFACE_POLL_INTERVAL_MS,
}) {
  const deadline = Date.now() + timeoutMs;
  const topLevelShell = page.getByTestId(shellTestId);
  const normalizedExpectedPathname = normalizePathname(expectedPathname);

  while (Date.now() < deadline) {
    if (
      getPathname(page.url()) === normalizedExpectedPathname &&
      (await isShellVisible(topLevelShell))
    ) {
      return {
        kind: "top-level",
        shell: topLevelShell,
      };
    }

    const embeddedFrame = findEmbeddedAppFrame(page, normalizedExpectedPathname);

    if (embeddedFrame && (await isShellVisible(embeddedFrame.getByTestId(shellTestId)))) {
      return {
        kind: "iframe",
        frame: embeddedFrame,
      };
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  return null;
}

export async function expectEmbeddedAppSurface({
  page,
  requestedUrl,
  expectedPathname,
  shellTestId,
}) {
  const normalizedExpectedPathname = normalizePathname(expectedPathname);
  await page.goto(requestedUrl);

  const topLevelShell = page.getByTestId(shellTestId);
  const surface = await detectEmbeddedAppSurface({
    page,
    expectedPathname: normalizedExpectedPathname,
    shellTestId,
  });

  if (surface?.kind === "top-level") {
    await expect.poll(() => getPathname(page.url())).toBe(normalizedExpectedPathname);
    await expect(topLevelShell).toBeVisible();
    return;
  }

  if (surface?.kind === "iframe") {
    await expect.poll(() => getPathname(surface.frame.url())).toBe(normalizedExpectedPathname);
    await expect(surface.frame.getByTestId(shellTestId)).toBeVisible();
    return;
  }

  throw new Error(
    `Embedded app surface for ${normalizedExpectedPathname} was not found before timeout.`,
  );
}
