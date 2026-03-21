import test from "node:test";
import assert from "node:assert/strict";

import {
  applyShopifyDevAppUrl,
  resolveShopifyAppUrl,
} from "../../scripts/shopify-dev-app-url.mjs";

test("resolveShopifyAppUrl prefers HOST over placeholder SHOPIFY_APP_URL", () => {
  const env = {
    HOST: "https://abc.trycloudflare.com",
    SHOPIFY_APP_URL: "https://example.com",
  };
  assert.equal(resolveShopifyAppUrl(env), "https://abc.trycloudflare.com");
});

test("resolveShopifyAppUrl ignores documentation placeholder hosts", () => {
  assert.equal(
    resolveShopifyAppUrl({
      HOST: "https://example.com",
      SHOPIFY_APP_URL: "https://www.example.com",
    }),
    "",
  );
});

test("applyShopifyDevAppUrl writes SHOPIFY_APP_URL when tunnel is present", () => {
  const env = {
    HOST: "https://tunnel.example.org/",
    SHOPIFY_APP_URL: "https://example.com",
  };
  applyShopifyDevAppUrl(env);
  assert.equal(env.SHOPIFY_APP_URL, "https://tunnel.example.org");
});

test("resolveShopifyAppUrl prefers APP_URL from Shopify CLI web env", () => {
  const env = {
    APP_URL: "https://cli-app-url.trycloudflare.com",
    SHOPIFY_APP_URL: "https://example.com",
  };
  assert.equal(resolveShopifyAppUrl(env), "https://cli-app-url.trycloudflare.com");
});

test("applyShopifyDevAppUrl removes placeholder SHOPIFY_APP_URL when no tunnel env is set", () => {
  const env = { SHOPIFY_APP_URL: "https://example.com" };
  applyShopifyDevAppUrl(env);
  assert.equal(env.SHOPIFY_APP_URL, undefined);
});
