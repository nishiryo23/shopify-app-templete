import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  DEFAULT_STATE_FILE,
  loadLoopState,
  parseArgs,
  resolvePriorReview,
  saveLoopState,
} from "../../scripts/run-codex-shopify-review-loop.mjs";

test("parseArgs defaults stateFile and accepts override", () => {
  assert.equal(parseArgs([]).stateFile, DEFAULT_STATE_FILE);
  assert.equal(parseArgs(["--state-file", "tmp/review-state.json"]).stateFile, "tmp/review-state.json");
});

test("resolvePriorReview restores persisted review only for matching thread id", () => {
  const priorReview = {
    phase: "review",
    status: "findings",
    summary: "Outstanding finding remains.",
    findings: [{ severity: "high", title: "x", file: "y", recommendation: "z" }],
    stopReason: "",
  };

  assert.deepEqual(
    resolvePriorReview({
      persistedState: {
        fixThreadId: "thread-123",
        priorReview,
      },
      threadId: "thread-123",
    }),
    priorReview,
  );
  assert.equal(
    resolvePriorReview({
      persistedState: {
        fixThreadId: "thread-123",
        priorReview,
      },
      threadId: "thread-456",
    }),
    null,
  );
});

test("saveLoopState persists review state that loadLoopState can restore", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-review-loop-state-"));
  const stateFilePath = path.join(tempDir, "state.json");
  const state = {
    fixThreadId: "thread-789",
    priorReview: {
      phase: "review",
      status: "blocked",
      summary: "Diff mixing blocked review.",
      findings: [],
      stopReason: "unrelated diff remains",
    },
  };

  await saveLoopState(stateFilePath, state);

  assert.deepEqual(await loadLoopState(stateFilePath), state);
  assert.equal(await loadLoopState(path.join(tempDir, "missing.json")), null);
});
