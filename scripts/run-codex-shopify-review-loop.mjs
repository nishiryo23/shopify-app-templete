#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Codex } from "@openai/codex-sdk";

import {
  buildReviewPrompt,
  buildLoopPrompt,
  formatLoopSummary,
  LOOP_OUTPUT_SCHEMA,
  parseStructuredResponse,
  REVIEW_OUTPUT_SCHEMA,
} from "./lib/codex-review-loop.mjs";

const DEFAULT_STATE_FILE = ".codex-shopify-review-loop-state.json";
const STATE_SCHEMA_VERSION = 2;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workingDirectory = path.resolve(options.cwd);
  const stateFilePath = path.resolve(workingDirectory, options.stateFile);

  const codex = new Codex();
  const loopThread =
    options.threadId == null
      ? codex.startThread({
          workingDirectory,
          sandboxMode: options.fixSandbox,
          approvalPolicy: options.approvalPolicy,
          networkAccessEnabled: true,
          webSearchMode: "live",
          model: options.model,
          skipGitRepoCheck: options.skipGitRepoCheck,
        })
      : codex.resumeThread(options.threadId, {
          workingDirectory,
          sandboxMode: options.fixSandbox,
          approvalPolicy: options.approvalPolicy,
          networkAccessEnabled: true,
          webSearchMode: "live",
          model: options.model,
          skipGitRepoCheck: options.skipGitRepoCheck,
        });

  const persistedState = await loadLoopState(stateFilePath);
  const priorState = resolveLoopState({
    persistedState,
    threadId: options.threadId,
  });

  console.log(`\n[loop] starting autonomous run (max iterations: ${options.maxIterations})`);

  const loopTurn = await loopThread.run(
    buildLoopPrompt({
      maxIterations: options.maxIterations,
      lastIteration: priorState?.lastIteration ?? 0,
      lastReview: priorState?.lastReview ?? null,
    }),
    { outputSchema: LOOP_OUTPUT_SCHEMA },
  );
  const loopResult = parseStructuredResponse(loopTurn.finalResponse, "loop");
  const finalLoopResult =
    loopResult.status === "complete"
      ? await runExternalReviewGate({
          codex,
          loopResult,
          maxIterations: options.maxIterations,
          model: options.model,
          reviewSandbox: options.reviewSandbox,
          skipGitRepoCheck: options.skipGitRepoCheck,
          workingDirectory,
        })
      : loopResult;

  console.log(JSON.stringify(finalLoopResult, null, 2));
  console.log(`\n${formatLoopSummary(finalLoopResult)}`);

  await saveLoopState(stateFilePath, {
    schemaVersion: STATE_SCHEMA_VERSION,
    loopThreadId: loopThread.id ?? options.threadId ?? null,
    lastIteration: getLastIteration(finalLoopResult),
    lastReview: getLastReview(finalLoopResult),
    lastLoopResult: finalLoopResult,
  });

  if (finalLoopResult.status === "blocked") {
    console.error("\nLoop blocked.");
    printLoopThreadId(loopThread);
    process.exitCode = 1;
    return;
  }

  console.log("\nLoop completed clean.");
  printLoopThreadId(loopThread);
}

function parseArgs(argv) {
  const options = {
    approvalPolicy: "never",
    cwd: process.cwd(),
    fixSandbox: "workspace-write",
    maxIterations: 5,
    model: undefined,
    reviewSandbox: "read-only",
    skipGitRepoCheck: false,
    stateFile: DEFAULT_STATE_FILE,
    threadId: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--cwd":
        options.cwd = requireValue(argv, ++index, "--cwd");
        break;
      case "--max-iterations":
        options.maxIterations = parsePositiveInteger(
          requireValue(argv, ++index, "--max-iterations"),
          "--max-iterations",
        );
        break;
      case "--model":
        options.model = requireValue(argv, ++index, "--model");
        break;
      case "--thread-id":
        options.threadId = requireValue(argv, ++index, "--thread-id");
        break;
      case "--approval-policy":
        options.approvalPolicy = requireApprovalPolicy(
          requireValue(argv, ++index, "--approval-policy"),
        );
        break;
      case "--fix-sandbox":
        options.fixSandbox = requireSandboxMode(
          requireValue(argv, ++index, "--fix-sandbox"),
          "--fix-sandbox",
        );
        break;
      case "--review-sandbox":
        options.reviewSandbox = requireSandboxMode(
          requireValue(argv, ++index, "--review-sandbox"),
          "--review-sandbox",
        );
        break;
      case "--state-file":
        options.stateFile = requireValue(argv, ++index, "--state-file");
        break;
      case "--skip-git-repo-check":
        options.skipGitRepoCheck = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function loadLoopState(stateFilePath) {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function resolvePriorReview({ persistedState, threadId }) {
  const loopState = resolveLoopState({ persistedState, threadId });
  return loopState?.lastReview ?? null;
}

async function runExternalReviewGate({
  codex,
  loopResult,
  maxIterations,
  model,
  reviewSandbox,
  skipGitRepoCheck,
  workingDirectory,
}) {
  const reviewThread = codex.startThread({
    workingDirectory,
    sandboxMode: reviewSandbox,
    approvalPolicy: "never",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    model,
    skipGitRepoCheck,
  });
  const reviewTurn = await reviewThread.run(
    buildReviewPrompt({
      iteration: getLastIteration(loopResult),
      maxIterations,
    }),
    { outputSchema: REVIEW_OUTPUT_SCHEMA },
  );
  const reviewResult = parseStructuredResponse(reviewTurn.finalResponse, "review");

  if (reviewResult.status === "clean") {
    return {
      ...loopResult,
      finalReview: reviewResult,
    };
  }

  return {
    ...loopResult,
    status: "blocked",
    summary: `External read-only review gate failed: ${reviewResult.summary}`,
    finalReview: reviewResult,
    blockedReason: "review_blocked",
    nextAction: getExternalReviewNextAction(reviewResult),
  };
}

function resolveLoopState({ persistedState, threadId }) {
  if (!threadId || !persistedState) {
    return null;
  }

  const migratedState = migrateLoopState(persistedState);
  if (migratedState == null || migratedState.loopThreadId !== threadId) {
    return null;
  }

  return migratedState;
}

function migrateLoopState(persistedState) {
  if (persistedState == null || typeof persistedState !== "object") {
    return null;
  }

  if (persistedState.schemaVersion === STATE_SCHEMA_VERSION) {
    return persistedState;
  }

  if ("fixThreadId" in persistedState || "priorReview" in persistedState) {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      loopThreadId: persistedState.fixThreadId ?? null,
      lastIteration: 0,
      lastReview: persistedState.priorReview ?? null,
      lastLoopResult: null,
    };
  }

  return null;
}

async function saveLoopState(stateFilePath, state) {
  await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function printLoopThreadId(loopThread) {
  console.log(`Loop thread id: ${loopThread.id ?? "unknown"}`);
}

function getLastIteration(loopResult) {
  if (!Array.isArray(loopResult?.iterations) || loopResult.iterations.length === 0) {
    return 0;
  }

  return loopResult.iterations[loopResult.iterations.length - 1].iteration;
}

function getLastReview(loopResult) {
  if (loopResult?.finalReview == null) {
    return null;
  }

  return {
    phase: "review",
    status: loopResult.finalReview.status,
    findings: loopResult.finalReview.findings,
  };
}

function getExternalReviewNextAction(reviewResult) {
  if (reviewResult.status === "findings" && Array.isArray(reviewResult.findings) && reviewResult.findings.length > 0) {
    return reviewResult.findings[0].recommendation;
  }

  return reviewResult.stopReason || reviewResult.summary;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (value == null) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function requireSandboxMode(value, flag) {
  const allowed = new Set(["read-only", "workspace-write", "danger-full-access"]);
  if (!allowed.has(value)) {
    throw new Error(`${flag} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function requireApprovalPolicy(value) {
  const allowed = new Set(["never", "on-request", "on-failure", "untrusted"]);
  if (!allowed.has(value)) {
    throw new Error(`--approval-policy must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/run-codex-shopify-review-loop.mjs [options]

Options:
  --cwd <path>                Working directory to review and edit
  --max-iterations <n>        Maximum autonomous loop iterations (default: 5)
  --model <name>              Codex model name
  --thread-id <id>            Resume an existing loop thread
  --approval-policy <mode>    never | on-request | on-failure | untrusted
  --fix-sandbox <mode>        Sandbox for the autonomous loop thread
  --review-sandbox <mode>     Deprecated, accepted for compatibility and ignored
  --state-file <path>         Persist loop resume state (default: ${DEFAULT_STATE_FILE})
  --skip-git-repo-check       Allow non-git working directories
  --help                      Show this help
`);
}

export {
  DEFAULT_STATE_FILE,
  loadLoopState,
  migrateLoopState,
  parseArgs,
  resolvePriorReview,
  resolveLoopState,
  runExternalReviewGate,
  saveLoopState,
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
