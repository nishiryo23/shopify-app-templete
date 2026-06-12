#!/usr/bin/env node
/**
 * Parses Cursor CLI `--output-format json` lines on stdin for Rigg shell steps.
 * Usage: node scripts/rigg-cursor-headless.mjs json|text
 */
import process from "node:process";

const mode = process.argv[2];
if (mode !== "json" && mode !== "text") {
  console.error("usage: node scripts/rigg-cursor-headless.mjs json|text");
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseCursorEvents(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("cursor headless output was empty");
  }

  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const events = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const candidate = line.trim();
      if (candidate === "") continue;
      try {
        events.push(JSON.parse(candidate));
      } catch {
        // Ignore non-JSON lines.
      }
    }
    if (events.length > 0) return events;
  }

  throw new Error(
    `cursor headless output did not contain parseable JSON: ${JSON.stringify(trimmed.slice(0, 200))}`,
  );
}

function getFinalResultText(raw) {
  const events = parseCursorEvents(raw);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const payload = events[index];
    if (payload?.type === "result" && typeof payload.result === "string") {
      return payload.result;
    }
  }
  throw new Error("cursor headless output missing final result text");
}

function extractFirstJsonValue(text) {
  const trimmed = text.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let end = index; end < trimmed.length; end += 1) {
      const current = trimmed[end];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === "\\") {
          escaped = true;
          continue;
        }
        if (current === "\"") {
          inString = false;
        }
        continue;
      }

      if (current === "\"") {
        inString = true;
        continue;
      }

      if (current === "{" || current === "[") {
        depth += 1;
        continue;
      }

      if (current === "}" || current === "]") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(index, end + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error(
    `cursor headless result did not contain a JSON object or array: ${JSON.stringify(trimmed.slice(0, 200))}`,
  );
}

try {
  const raw = await readStdin();
  const resultText = getFinalResultText(raw);
  process.stdout.write(mode === "text" ? resultText.trim() : extractFirstJsonValue(resultText));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
