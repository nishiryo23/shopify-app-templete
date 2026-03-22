import test from "node:test";
import assert from "node:assert/strict";

import {
  issueProductExportDownloadToken,
  PRODUCT_EXPORT_DOWNLOAD_TOKEN_TTL_SECONDS,
  verifyProductExportDownloadToken,
} from "../../domain/products/download-token.mjs";
import {
  extractProductExportDownloadError,
  startProductExportDocumentDownload,
} from "../../app/utils/product-export-download.mjs";

test("product export download token round-trips shop, job, and ttl", () => {
  const token = issueProductExportDownloadToken({
    jobId: "export-1",
    now: Date.UTC(2026, 2, 22, 0, 0, 0),
    secret: "test-secret",
    shopDomain: "example.myshopify.com",
  });
  const payload = verifyProductExportDownloadToken(token, {
    now: Date.UTC(2026, 2, 22, 0, 0, 30),
    secret: "test-secret",
  });

  assert.equal(payload.jobId, "export-1");
  assert.equal(payload.shopDomain, "example.myshopify.com");
  assert.equal(payload.exp, Math.floor(Date.UTC(2026, 2, 22, 0, 0, 0) / 1000) + PRODUCT_EXPORT_DOWNLOAD_TOKEN_TTL_SECONDS);
});

test("product export download token rejects expired or tampered tokens", () => {
  const token = issueProductExportDownloadToken({
    jobId: "export-1",
    now: Date.UTC(2026, 2, 22, 0, 0, 0),
    secret: "test-secret",
    shopDomain: "example.myshopify.com",
  });

  assert.equal(
    verifyProductExportDownloadToken(token, {
      now: Date.UTC(2026, 2, 22, 0, 2, 0),
      secret: "test-secret",
    }),
    null,
  );
  assert.equal(verifyProductExportDownloadToken(`${token}x`, { secret: "test-secret" }), null);
});

test("product export download error preserves server json text and auth loss", async () => {
  assert.equal(
    await extractProductExportDownloadError(new Response(JSON.stringify({
      error: "エクスポートファイルが見つかりません。保持期間が過ぎた可能性があります",
    }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
      status: 404,
    })),
    "エクスポートファイルが見つかりません。保持期間が過ぎた可能性があります",
  );

  assert.equal(
    await extractProductExportDownloadError(new Response(null, {
      headers: { "X-Shopify-Retry-Invalid-Session-Request": "1" },
      status: 401,
    })),
    "認証文脈が失われたため、Shopify 管理画面からアプリを開き直して再試行してください。",
  );
});

test("product export document download opens a new tab so get failures remain visible", () => {
  const clicks = [];
  const openedWindow = {
    close() {
      clicks.push("closed");
    },
    location: {
      assign(url) {
        clicks.push(`assign:${url}`);
      },
    },
    opener: "set",
  };

  const pendingDownload = startProductExportDocumentDownload({
      createAnchor: () => ({
        click() {
          clicks.push("clicked");
        },
      set href(value) {
        this._href = value;
      },
      set rel(value) {
        this._rel = value;
      },
      set target(value) {
        this._target = value;
      },
    }),
    openWindow: () => openedWindow,
  });

  assert.equal(openedWindow.opener, null);

  pendingDownload.navigate("/app/product-exports?downloadToken=signed-token");
  pendingDownload.close();

  assert.deepEqual(clicks, [
    "assign:/app/product-exports?downloadToken=signed-token",
    "closed",
  ]);
});

test("product export document download falls back to anchor click when no window handle is available", () => {
  const clicks = [];

  const pendingDownload = startProductExportDocumentDownload({
    createAnchor: () => ({
      click() {
        clicks.push("clicked");
      },
      set href(value) {
        this._href = value;
      },
      set rel(value) {
        this._rel = value;
      },
      set target(value) {
        this._target = value;
      },
    }),
    openWindow: () => null,
  });

  pendingDownload.navigate("/app/product-exports?downloadToken=signed-token");

  assert.deepEqual(clicks, ["clicked"]);
});
