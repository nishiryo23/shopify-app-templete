#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MIN_CODEX_VERSION = "0.118.0";
const DEFAULT_CODEX_MODEL = "gpt-5.5";

function stripAnsi(text) {
  const escape = String.fromCharCode(27);
  return text.replace(new RegExp(`${escape}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");
}

function parseVersion(text) {
  const match = stripAnsi(text).match(/\b(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\b/);
  if (!match) return null;

  return {
    raw: match[0],
    parts: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    prerelease: match[4] ?? "",
  };
}

function comparePrerelease(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];

    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;

    const leftNumber = /^\d+$/.test(leftPart) ? Number.parseInt(leftPart, 10) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number.parseInt(rightPart, 10) : null;

    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber > rightNumber) return 1;
      if (leftNumber < rightNumber) return -1;
      continue;
    }

    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] > right.parts[index]) return 1;
    if (left.parts[index] < right.parts[index]) return -1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function fail(message, details = "") {
  const lines = [
    "Codex CLI version preflight failed.",
    message,
    `Update Codex CLI before rerunning this rigg workflow: npm i -g @openai/codex`,
  ];

  if (details) lines.push(`Codex output: ${details}`);

  console.error(lines.join("\n"));
  process.exit(1);
}

function resolveDefaultCodexBin() {
  const voltaHome = process.env.VOLTA_HOME || (process.env.HOME ? path.join(process.env.HOME, ".volta") : "");
  if (voltaHome) {
    const voltaShim = path.join(voltaHome, "bin", process.platform === "win32" ? "codex.cmd" : "codex");
    if (existsSync(voltaShim)) return voltaShim;
  }

  return "codex";
}

const codexBin = process.env.RIGG_CODEX_BIN || resolveDefaultCodexBin();
const defaultMinVersion = parseVersion(DEFAULT_MIN_CODEX_VERSION);
const requestedMinVersion = parseVersion(process.env.RIGG_MIN_CODEX_VERSION || DEFAULT_MIN_CODEX_VERSION);
const model = process.env.RIGG_CODEX_MODEL || DEFAULT_CODEX_MODEL;

if (!requestedMinVersion) {
  fail(`RIGG_MIN_CODEX_VERSION must be a semantic version, got: ${process.env.RIGG_MIN_CODEX_VERSION}`);
}

const minVersion =
  compareVersions(requestedMinVersion, defaultMinVersion) < 0
    ? defaultMinVersion
    : requestedMinVersion;

const result = spawnSync(codexBin, ["--version"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    fail(`\`${codexBin}\` was not found on PATH.`);
  }
  fail(result.error.message);
}

const rawOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

if (result.status !== 0) {
  fail(`\`${codexBin} --version\` exited with code ${result.status}.`, rawOutput.slice(0, 300));
}

const installedVersion = parseVersion(rawOutput);

if (!installedVersion) {
  fail(`Could not parse \`${codexBin} --version\`.`, rawOutput.slice(0, 300));
}

if (compareVersions(installedVersion, minVersion) < 0) {
  fail(
    `This harness uses \`${model}\`, which requires Codex CLI >= ${minVersion.raw}. Installed: ${installedVersion.raw}.`,
    rawOutput.slice(0, 300),
  );
}
