#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

function stripAnsi(text) {
  const escape = String.fromCharCode(27);
  return text.replace(new RegExp(`${escape}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");
}

function fail(message, details = "") {
  const lines = [
    "Cursor CLI authentication preflight failed for `mode: \"cursor\"`.",
    "Run `cursor agent login`, complete the browser sign-in flow, then verify with `cursor agent status` before rerunning this rigg workflow.",
  ];

  if (message) lines.push(`Reason: ${message}`);
  if (details) lines.push(`Cursor output: ${details}`);

  console.error(lines.join("\n"));
  process.exit(1);
}

const cursorBin = process.env.RIGG_CURSOR_BIN || "cursor";
const result = spawnSync(cursorBin, ["agent", "status"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    fail(`\`${cursorBin}\` was not found on PATH.`);
  }
  fail(result.error.message);
}

const rawOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
const output = stripAnsi(rawOutput).replace(/\s+/g, " ").trim();

if (result.status !== 0) {
  fail(`\`cursor agent status\` exited with code ${result.status}.`, output.slice(0, 300));
}

if (!/logged in as/i.test(output)) {
  fail("`cursor agent status` did not report a logged-in user.", output.slice(0, 300));
}
