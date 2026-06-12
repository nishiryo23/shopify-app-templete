#!/usr/bin/env node
import process from "node:process";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
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
    `input did not contain a JSON object or array: ${JSON.stringify(trimmed.slice(0, 200))}`,
  );
}

try {
  const raw = await readStdin();
  process.stdout.write(extractFirstJsonValue(raw));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
