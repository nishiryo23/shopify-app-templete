import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  DEFAULT_STATE_FILE,
  loadLoopState,
  migrateLoopState,
  parseArgs,
  resolveLoopState,
  runExternalReviewGate,
  saveLoopState,
} from "../../scripts/run-codex-shopify-review-loop.mjs";

test("parseArgs defaults stateFile and accepts override", () => {
  assert.equal(parseArgs([]).stateFile, DEFAULT_STATE_FILE);
  assert.equal(parseArgs(["--state-file", "tmp/review-state.json"]).stateFile, "tmp/review-state.json");
});

test("migrateLoopState upgrades v1 state into v2 shape", () => {
  assert.deepEqual(
    migrateLoopState({
      fixThreadId: "thread-123",
      priorReview: {
        phase: "review",
        status: "findings",
        findings: [{ severity: "high", title: "x", file: "y", recommendation: "z" }],
      },
    }),
    {
      schemaVersion: 2,
      loopThreadId: "thread-123",
      lastIteration: 0,
      lastReview: {
        phase: "review",
        status: "findings",
        findings: [{ severity: "high", title: "x", file: "y", recommendation: "z" }],
      },
      lastLoopResult: null,
    },
  );
});

test("resolveLoopState restores persisted state only for matching loop thread id", () => {
  const persistedState = {
    schemaVersion: 2,
    loopThreadId: "loop-123",
    lastIteration: 3,
    lastReview: {
      phase: "review",
      status: "findings",
      findings: [{ severity: "medium", title: "x", file: "y", recommendation: "z" }],
    },
    lastLoopResult: null,
  };

  assert.deepEqual(
    resolveLoopState({ persistedState, threadId: "loop-123" }),
    persistedState,
  );
  assert.equal(resolveLoopState({ persistedState, threadId: "loop-456" }), null);
});

test("saveLoopState persists v2 loop state that loadLoopState can restore", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-review-loop-state-"));
  const stateFilePath = path.join(tempDir, "state.json");
  const state = {
    schemaVersion: 2,
    loopThreadId: "loop-789",
    lastIteration: 4,
    lastReview: {
      phase: "review",
      status: "blocked",
      findings: [],
    },
    lastLoopResult: {
      phase: "loop",
      status: "blocked",
      summary: "Reached iteration limit.",
      iterations: [],
      finalRemediation: {
        status: "blocked",
        rootCause: "missing auth guard",
        repoEvidence: [],
        shopifyDocsEvidence: [],
        validationEvidence: [],
        residualRisk: [],
      },
      finalReview: { status: "blocked", findings: [] },
      finalReadiness: { status: "skipped", gaps: [] },
      blockedReason: "iteration_limit",
      nextAction: "Reduce scope and retry.",
    },
  };

  await saveLoopState(stateFilePath, state);

  assert.deepEqual(await loadLoopState(stateFilePath), state);
  assert.equal(await loadLoopState(path.join(tempDir, "missing.json")), null);
});

test("runExternalReviewGate blocks completion when the read-only review finds issues", async () => {
  const prompts = [];
  const codex = {
    startThread(args) {
      assert.equal(args.sandboxMode, "read-only");
      assert.equal(args.networkAccessEnabled, false);
      return {
        async run(prompt) {
          prompts.push(prompt);
          return {
            finalResponse: JSON.stringify({
              phase: "review",
              status: "findings",
              summary: "Read-only review found one issue.",
              findings: [{
                severity: "high",
                title: "Missing read-only boundary",
                file: "scripts/run-codex-shopify-review-loop.mjs",
                recommendation: "Restore a separate review thread.",
              }],
              stopReason: "",
            }),
          };
        },
      };
    },
  };

  const result = await runExternalReviewGate({
    codex,
    loopResult: {
      phase: "loop",
      status: "complete",
      summary: "Internal loop completed.",
      iterations: [{ iteration: 1, rootCause: "x", fixStatus: "completed", reviewStatus: "clean", readinessStatus: "clean", summary: "y" }],
      finalRemediation: {
        status: "pass",
        rootCause: "x",
        repoEvidence: [],
        shopifyDocsEvidence: [],
        validationEvidence: [],
        residualRisk: [],
      },
      finalReview: { status: "clean", findings: [] },
      finalReadiness: { status: "clean", gaps: [] },
      blockedReason: null,
      nextAction: "Ship it.",
    },
    maxIterations: 5,
    model: "gpt-5",
    reviewSandbox: "read-only",
    skipGitRepoCheck: false,
    workingDirectory: "/tmp/repo",
  });

  assert.match(prompts[0], /external read-only review gate/i);
  assert.equal(result.status, "blocked");
  assert.equal(result.blockedReason, "review_blocked");
  assert.equal(result.finalReview.status, "findings");
  assert.equal(result.nextAction, "Restore a separate review thread.");
});
