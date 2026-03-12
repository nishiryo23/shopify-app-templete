import test from "node:test";
import assert from "node:assert/strict";

import config from "../../playwright.config.mjs";

test("smoke scaffold retains Playwright traces on first failure without retries", () => {
  assert.equal(config.retries, 0);
  assert.equal(config.use.trace, "retain-on-failure");
});
