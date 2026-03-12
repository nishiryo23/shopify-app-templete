#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Codex } from "@openai/codex-sdk";

import {
  buildFixPrompt,
  buildReviewPrompt,
  FIX_OUTPUT_SCHEMA,
  formatIterationSummary,
  parseStructuredResponse,
  REVIEW_OUTPUT_SCHEMA,
  shouldContinueLoop,
} from "./lib/codex-review-loop.mjs";

const DEFAULT_STATE_FILE = ".codex-shopify-review-loop-state.json";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workingDirectory = path.resolve(options.cwd);
  const stateFilePath = path.resolve(workingDirectory, options.stateFile);

  const codex = new Codex();
  const fixThread =
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
  let priorReview = resolvePriorReview({
    persistedState,
    threadId: options.threadId,
  });

  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    console.log(`\n[fix ${iteration}/${options.maxIterations}] starting`);

    const fixTurn = await fixThread.run(
      buildFixPrompt({
        iteration,
        maxIterations: options.maxIterations,
        priorReview,
      }),
      { outputSchema: FIX_OUTPUT_SCHEMA },
    );
    const fixResult = parseStructuredResponse(fixTurn.finalResponse, "fix");

    console.log(JSON.stringify(fixResult, null, 2));

    if (fixResult.status === "blocked") {
      await saveLoopState(stateFilePath, {
        fixThreadId: fixThread.id ?? options.threadId ?? null,
        priorReview,
      });
      console.error("\nFix phase blocked.");
      printFixThreadId(fixThread);
      process.exitCode = 1;
      return;
    }

    console.log(`\n[review ${iteration}/${options.maxIterations}] starting`);

    const reviewThread = codex.startThread({
      workingDirectory,
      sandboxMode: options.reviewSandbox,
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
      model: options.model,
      skipGitRepoCheck: options.skipGitRepoCheck,
    });
    const reviewTurn = await reviewThread.run(
      buildReviewPrompt({
        iteration,
        maxIterations: options.maxIterations,
      }),
      { outputSchema: REVIEW_OUTPUT_SCHEMA },
    );
    const reviewResult = parseStructuredResponse(reviewTurn.finalResponse, "review");

    console.log(JSON.stringify(reviewResult, null, 2));
    console.log(`\n${formatIterationSummary({ iteration, fixResult, reviewResult })}`);
    await saveLoopState(stateFilePath, {
      fixThreadId: fixThread.id ?? options.threadId ?? null,
      priorReview: reviewResult,
    });

    if (reviewResult.status === "blocked") {
      console.error("\nReview phase blocked.");
      printFixThreadId(fixThread);
      process.exitCode = 1;
      return;
    }

    if (!shouldContinueLoop(reviewResult)) {
      console.log("\nReview returned clean. Stopping.");
      printFixThreadId(fixThread);
      return;
    }

    priorReview = reviewResult;
  }

  console.error(`\nReached max iterations (${options.maxIterations}) without a clean review.`);
  printFixThreadId(fixThread);
  process.exitCode = 1;
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
  if (!threadId || !persistedState || persistedState.fixThreadId !== threadId) {
    return null;
  }

  return persistedState.priorReview ?? null;
}

async function saveLoopState(stateFilePath, state) {
  await fs.writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function printFixThreadId(fixThread) {
  console.log(`Fix thread id: ${fixThread.id ?? "unknown"}`);
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
  --max-iterations <n>        Maximum fix/review cycles (default: 5)
  --model <name>              Codex model name
  --thread-id <id>            Resume an existing fix thread
  --approval-policy <mode>    never | on-request | on-failure | untrusted
  --fix-sandbox <mode>        read-only | workspace-write | danger-full-access
  --review-sandbox <mode>     read-only | workspace-write | danger-full-access
  --state-file <path>         Persist last review state for resume (default: ${DEFAULT_STATE_FILE})
  --skip-git-repo-check       Allow non-git working directories
  --help                      Show this help
`);
}

export {
  DEFAULT_STATE_FILE,
  loadLoopState,
  parseArgs,
  resolvePriorReview,
  saveLoopState,
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
