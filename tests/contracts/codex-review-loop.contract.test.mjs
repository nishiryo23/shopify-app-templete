import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFixPrompt,
  buildReviewPrompt,
  formatIterationSummary,
  parseStructuredResponse,
  shouldContinueLoop,
} from "../../scripts/lib/codex-review-loop.mjs";

test("buildFixPrompt includes prior findings and single-pass constraint", () => {
  const prompt = buildFixPrompt({
    iteration: 2,
    maxIterations: 5,
    priorReview: {
      status: "findings",
      summary: "Two review findings remain.",
      findings: [
        {
          severity: "high",
          title: "Missing auth guard",
          file: "app/routes/foo.ts",
          recommendation: "Validate session token before access.",
        },
      ],
    },
  });

  assert.match(prompt, /Use \$shopify-review-fix for exactly one remediation pass/);
  assert.match(prompt, /Missing auth guard/);
  assert.match(prompt, /Do not mix unrelated changes into this pass/);
});

test("buildReviewPrompt targets current uncommitted diff in read-only mode", () => {
  const prompt = buildReviewPrompt({ iteration: 1, maxIterations: 3 });

  assert.match(prompt, /Review the current uncommitted changes/);
  assert.match(prompt, /Do not modify any files/);
  assert.match(prompt, /status "blocked"/);
});

test("parseStructuredResponse returns parsed JSON", () => {
  const parsed = parseStructuredResponse('{"phase":"review","status":"clean"}', "review");
  assert.equal(parsed.phase, "review");
  assert.equal(parsed.status, "clean");
});

test("parseStructuredResponse throws for invalid JSON", () => {
  assert.throws(
    () => parseStructuredResponse("not-json", "review"),
    /review response was not valid JSON/,
  );
});

test("shouldContinueLoop only continues on findings", () => {
  assert.equal(shouldContinueLoop({ status: "findings" }), true);
  assert.equal(shouldContinueLoop({ status: "clean" }), false);
  assert.equal(shouldContinueLoop({ status: "blocked" }), false);
});

test("formatIterationSummary summarizes fix and review statuses", () => {
  const summary = formatIterationSummary({
    iteration: 3,
    fixResult: { status: "completed", rootCause: "missing webhook validation" },
    reviewResult: {
      status: "findings",
      findings: [{ severity: "medium", title: "x", file: "y", recommendation: "z" }],
    },
  });

  assert.equal(
    summary,
    "Iteration 3 | fix: completed (missing webhook validation) | review: findings (1 findings)",
  );
});
