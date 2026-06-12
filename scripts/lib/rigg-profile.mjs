import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(message);
}

export function loadProfile(profilePath, options = {}) {
  const { checkDocs = false } = options;

  if (!existsSync(profilePath)) {
    fail(`repo profile not found: ${profilePath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch (error) {
    fail(`failed to parse repo profile JSON: ${error.message}`);
  }

  if (parsed.schemaVersion !== 1) fail("repo profile schemaVersion must be 1");
  if (typeof parsed.displayName !== "string" || parsed.displayName.trim() === "") {
    fail("repo profile displayName must be a non-empty string");
  }
  if (parsed.mode !== "cursor" && parsed.mode !== "codex") {
    fail('repo profile mode must be "cursor" or "codex"');
  }
  if (!Array.isArray(parsed.standardsDocs)) {
    fail("repo profile standardsDocs must be an array");
  }
  if (!Array.isArray(parsed.verifyCommands)) {
    fail("repo profile verifyCommands must be an array");
  }
  if (typeof parsed.greenfieldDefault !== "boolean") {
    fail("repo profile greenfieldDefault must be a boolean");
  }
  if (
    parsed.reviewScopeNote !== undefined &&
    typeof parsed.reviewScopeNote !== "string"
  ) {
    fail("repo profile reviewScopeNote must be a string");
  }
  if (!Array.isArray(parsed.forbiddenChanges)) {
    fail("repo profile forbiddenChanges must be an array");
  }

  const normalized = {
    schemaVersion: 1,
    displayName: parsed.displayName.trim(),
    mode: parsed.mode,
    standardsDocs: parsed.standardsDocs.map(String),
    verifyCommands: parsed.verifyCommands.map(String),
    greenfieldDefault: parsed.greenfieldDefault,
    reviewScopeNote: parsed.reviewScopeNote ?? "",
    forbiddenChanges: parsed.forbiddenChanges.map(String),
  };

  if (checkDocs) {
    const missingDocs = normalized.standardsDocs.filter(
      (relativePath) => !existsSync(path.resolve(relativePath)),
    );
    if (missingDocs.length > 0) {
      fail(`repo profile standardsDocs contain missing files: ${missingDocs.join(", ")}`);
    }
  }

  return normalized;
}
