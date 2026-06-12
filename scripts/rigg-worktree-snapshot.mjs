#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function run(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
  } catch (error) {
    return String(error.stdout ?? "").trimEnd();
  }
}

function hashBuffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

function listUntrackedFiles() {
  return run(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function buildUntrackedFingerprint(untrackedFiles) {
  const manifest = untrackedFiles.map((relativePath) => {
    try {
      return {
        path: relativePath,
        hash: hashBuffer(readFileSync(relativePath)),
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return {
          path: relativePath,
          missing: true,
        };
      }
      throw error;
    }
  });

  return hashBuffer(JSON.stringify(manifest));
}

const stagedDiff = run(["diff", "--cached"]);
const unstagedDiff = run(["diff"]);
const untrackedFiles = listUntrackedFiles();
const snapshot = {
  status: run(["status", "--short", "--branch", "--untracked-files=all"]),
  stagedStat: run(["diff", "--cached", "--stat"]),
  stagedDiffHash: hashBuffer(stagedDiff),
  unstagedStat: run(["diff", "--stat"]),
  unstagedDiffHash: hashBuffer(unstagedDiff),
  stagedNames: run(["diff", "--cached", "--name-only"]),
  unstagedNames: run(["diff", "--name-only"]),
  untracked: untrackedFiles.join("\n"),
  untrackedFingerprint: buildUntrackedFingerprint(untrackedFiles),
};

process.stdout.write(JSON.stringify(snapshot));
