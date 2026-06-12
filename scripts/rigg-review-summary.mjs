#!/usr/bin/env node
import { readFileSync } from "node:fs";
import process from "node:process";

const stateFile = process.argv[2];
const mode = process.argv[3] ?? "cursor";

if (!stateFile) {
  console.error("usage: node scripts/rigg-review-summary.mjs <state-file> [mode]");
  process.exit(2);
}

const state = JSON.parse(readFileSync(stateFile, "utf8"));
const iterations = state.iterations ?? [];
const firstIteration = iterations[0] ?? {};
const lastIteration = iterations[iterations.length - 1] ?? {};
const initialFindingCount = firstIteration.review?.findings?.length ?? 0;
const finalFindingCount = lastIteration.triage?.findings?.length ?? 0;
const verifyRan = lastIteration.verify !== undefined;
const verifyOk = lastIteration.verify?.ok ?? true;
const validateOk = lastIteration.validate?.status !== "needs_attention";
const clean = finalFindingCount === 0 && verifyOk && validateOk;

process.stdout.write(
  `${JSON.stringify(
    {
      status: clean ? "clean" : "needs_attention",
      iterations: iterations.length,
      initialFindingCount,
      finalFindingCount,
      verifyRan,
      verifyOk,
      mode,
    },
    null,
    2,
  )}\n`,
);
