import test from "node:test";
import assert from "node:assert/strict";

import { detectEmbeddedAppSurface } from "../smoke/helpers.mjs";

function createFakePage({
  mainUrl = "https://example.com/admin/apps/demo",
  topLevelVisibleAtTick = Number.POSITIVE_INFINITY,
  frameVisibleAtTick = Number.POSITIVE_INFINITY,
  frameUrl = "https://example.com/app",
}) {
  let tick = 0;
  const mainFrame = {
    url: () => mainUrl,
    getByTestId: () => ({
      isVisible: async () => false,
    }),
  };
  const embeddedFrame = {
    url: () => frameUrl,
    getByTestId: () => ({
      isVisible: async () => tick >= frameVisibleAtTick,
    }),
  };

  return {
    frames: () => [mainFrame, embeddedFrame],
    getByTestId: () => ({
      isVisible: async () => tick >= topLevelVisibleAtTick,
    }),
    mainFrame: () => mainFrame,
    url: () => mainUrl,
    waitForTimeout: async () => {
      tick += 1;
    },
  };
}

test("detectEmbeddedAppSurface keeps polling for a slow top-level app render", async () => {
  const page = createFakePage({
    mainUrl: "https://example.com/app",
    topLevelVisibleAtTick: 12,
    frameUrl: "https://example.com/admin/apps/demo",
  });

  const surface = await detectEmbeddedAppSurface({
    page,
    expectedPathname: "/app",
    shellTestId: "app-shell",
    timeoutMs: 3_000,
    pollIntervalMs: 100,
  });

  assert.deepEqual(surface?.kind, "top-level");
});

test("detectEmbeddedAppSurface returns iframe when Shopify admin embeds the app", async () => {
  const page = createFakePage({
    frameVisibleAtTick: 4,
  });

  const surface = await detectEmbeddedAppSurface({
    page,
    expectedPathname: "/app",
    shellTestId: "app-shell",
    timeoutMs: 2_000,
    pollIntervalMs: 100,
  });

  assert.deepEqual(surface?.kind, "iframe");
});

test("detectEmbeddedAppSurface normalizes trailing slash on top-level app URLs", async () => {
  const page = createFakePage({
    mainUrl: "https://example.com/app/",
    topLevelVisibleAtTick: 1,
  });

  const surface = await detectEmbeddedAppSurface({
    page,
    expectedPathname: "/app",
    shellTestId: "app-shell",
    timeoutMs: 1_000,
    pollIntervalMs: 100,
  });

  assert.deepEqual(surface?.kind, "top-level");
});

test("detectEmbeddedAppSurface normalizes trailing slash on embedded frame URLs", async () => {
  const page = createFakePage({
    frameUrl: "https://example.com/app/pricing/",
    frameVisibleAtTick: 1,
  });

  const surface = await detectEmbeddedAppSurface({
    page,
    expectedPathname: "/app/pricing",
    shellTestId: "app-shell",
    timeoutMs: 1_000,
    pollIntervalMs: 100,
  });

  assert.deepEqual(surface?.kind, "iframe");
});
