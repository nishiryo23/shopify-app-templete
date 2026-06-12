#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    fail(
      "usage: node scripts/rigg-review-state.mjs <init|record|capture> --state-file <path> [--iteration <n>] [--section <name>] [--slot <name>]",
    );
  }

  const options = { _: command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) fail(`missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function ensureDirectoryFor(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  if (!existsSync(filePath)) fail(`state file not found: ${filePath}`);
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureDirectoryFor(filePath);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function now() {
  return new Date().toISOString();
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
  } catch (error) {
    return String(error.stdout ?? "").trimEnd();
  }
}

function listLines(args) {
  return runGit(args)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function fingerprintFile(relativePath, kind) {
  try {
    return {
      path: relativePath,
      kind,
      hash: hashText(readFileSync(relativePath)),
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        path: relativePath,
        kind,
        missing: true,
      };
    }
    throw error;
  }
}

function buildWorktreeSnapshot() {
  const trackedChangedFiles = Array.from(
    new Set([
      ...listLines(["diff", "--cached", "--name-only"]),
      ...listLines(["diff", "--name-only"]),
    ]),
  ).sort();
  const untrackedFiles = listLines(["ls-files", "--others", "--exclude-standard"]);
  const fingerprints = [
    ...trackedChangedFiles.map((relativePath) => fingerprintFile(relativePath, "tracked")),
    ...untrackedFiles.map((relativePath) => fingerprintFile(relativePath, "untracked")),
  ];

  return {
    capturedAt: now(),
    status: runGit(["status", "--short", "--branch", "--untracked-files=all"]),
    stagedStat: runGit(["diff", "--cached", "--stat"]),
    unstagedStat: runGit(["diff", "--stat"]),
    trackedChangedFiles,
    untrackedFiles,
    fingerprints,
    fingerprintsHash: hashText(JSON.stringify(fingerprints)),
  };
}

function ensureIteration(state, iterationValue) {
  const iteration = Number(iterationValue);
  if (!Number.isInteger(iteration) || iteration <= 0) {
    fail(`iteration must be a positive integer: ${iterationValue}`);
  }

  let entry = state.iterations.find((item) => item.iteration === iteration);
  if (!entry) {
    entry = { iteration, updatedAt: now() };
    state.iterations.push(entry);
    state.iterations.sort((left, right) => left.iteration - right.iteration);
  }

  return entry;
}

function parseSectionPayload(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") fail("stdin payload was empty");
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

const args = parseArgs(process.argv.slice(2));
const stateFile = args["state-file"];
if (!stateFile) fail("--state-file is required");

if (args._ === "init") {
  const raw = await readStdin();
  const trimmed = raw.trim();
  if (trimmed === "") fail("stdin payload for init was empty");

  let baselineSnapshot;
  try {
    baselineSnapshot = JSON.parse(trimmed);
  } catch (error) {
    fail(`failed to parse baseline snapshot JSON: ${error.message}`);
  }

  writeJson(stateFile, {
    version: 1,
    mode: "review-harness",
    createdAt: now(),
    updatedAt: now(),
    baselineSnapshot,
    iterations: [],
  });
  process.exit(0);
}

if (args._ === "record") {
  if (!args.section) fail("--section is required for record");
  if (!args.iteration) fail("--iteration is required for record");
  const state = readJson(stateFile);
  const entry = ensureIteration(state, args.iteration);
  const raw = await readStdin();
  entry[args.section] = parseSectionPayload(raw);
  entry.updatedAt = now();
  state.updatedAt = now();
  writeJson(stateFile, state);
  process.exit(0);
}

if (args._ === "capture") {
  if (!args.slot) fail("--slot is required for capture");
  if (!args.iteration) fail("--iteration is required for capture");
  const state = readJson(stateFile);
  const entry = ensureIteration(state, args.iteration);
  entry[args.slot] = buildWorktreeSnapshot();
  entry.updatedAt = now();
  state.updatedAt = now();
  writeJson(stateFile, state);
  process.exit(0);
}

fail(`unknown command: ${args._}`);
