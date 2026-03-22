import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLoopPrompt,
  formatLoopSummary,
  LOOP_OUTPUT_SCHEMA,
  parseStructuredResponse,
} from "../../scripts/lib/codex-review-loop.mjs";

test("buildLoopPrompt requires autonomous iteration through clean or blocked", () => {
  const prompt = buildLoopPrompt({
    maxIterations: 5,
    lastIteration: 2,
    lastReview: {
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

  assert.match(prompt, /Use \$shopify-review-loop/);
  assert.match(prompt, /Do not stop after one remediation pass/);
  assert.match(prompt, /Only after remediation review is clean, run \$shopify-app-readiness-review/);
  assert.match(prompt, /Missing auth guard/);
  assert.match(prompt, /hard safety limit of 5 total iterations/);
  assert.doesNotMatch(prompt, /exactly one remediation pass/);
  assert.doesNotMatch(prompt, /Stop after this single remediation pass/);
});

test("LOOP_OUTPUT_SCHEMA fixes final loop status vocabulary", () => {
  assert.equal(LOOP_OUTPUT_SCHEMA.properties.phase.const, "loop");
  assert.deepEqual(LOOP_OUTPUT_SCHEMA.properties.status.enum, ["complete", "blocked"]);
  assert.deepEqual(LOOP_OUTPUT_SCHEMA.properties.blockedReason.anyOf[1].enum, [
    "iteration_limit",
    "fix_blocked",
    "review_blocked",
    "readiness_blocked",
    "permission_blocked",
    "evidence_missing",
    "unrelated_diff",
    "spec_conflict",
  ]);
});

test("parseStructuredResponse returns parsed JSON", () => {
  const parsed = parseStructuredResponse('{"phase":"loop","status":"complete"}', "loop");
  assert.equal(parsed.phase, "loop");
  assert.equal(parsed.status, "complete");
});

test("parseStructuredResponse throws for invalid JSON", () => {
  assert.throws(
    () => parseStructuredResponse("not-json", "loop"),
    /loop response was not valid JSON/,
  );
});

test("formatLoopSummary summarizes final loop state", () => {
  const summary = formatLoopSummary({
    status: "blocked",
    blockedReason: "iteration_limit",
    iterations: [
      { iteration: 1 },
      { iteration: 2 },
      { iteration: 3 },
    ],
  });

  assert.equal(summary, "Loop status: blocked, blockedReason: iteration_limit | iterations: 3");
});
