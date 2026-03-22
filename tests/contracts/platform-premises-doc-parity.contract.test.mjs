import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "../..");

const fixturePath = "tests/fixtures/truth/platform-premises.md";
const contractsManifestPath = "tests/fixtures/truth/platform-premises.contracts.json";
const premiseTruthSourceToken = "tests/fixtures/truth/platform-premises.md";
const indexPath = "docs/platform-truth-index.md";

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}

function trimBody(value) {
  return normalizeNewlines(value).trim();
}

function extractFixturePremisesBody(fixtureRaw) {
  return trimBody(fixtureRaw);
}

function parseFrontmatter(raw) {
  const normalized = normalizeNewlines(raw);
  if (!normalized.startsWith("---\n")) {
    return { body: normalized, front: null };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { body: normalized, front: null };
  }
  const yamlBlock = normalized.slice(4, end);
  const body = normalized.slice(end + "\n---\n".length);
  return { body, front: yamlBlock };
}

function truthSourcesIncludePremiseFixture(yamlBlock) {
  if (!yamlBlock) {
    return false;
  }
  const lines = yamlBlock.split("\n");
  let inSources = false;
  for (const line of lines) {
    if (line.startsWith("truth_sources:")) {
      inSources = true;
      continue;
    }
    if (inSources) {
      if (line.match(/^\S/) && !line.trimStart().startsWith("-")) {
        break;
      }
      const m = line.match(/^\s*-\s*(.+)\s*$/);
      if (m) {
        const v = m[1].trim();
        if (v === premiseTruthSourceToken) {
          return true;
        }
      }
    }
  }
  return false;
}

function listDocMarkdownFiles() {
  const dir = path.join(rootDir, "docs");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join("docs", name))
    .sort();
}

function parseDocsIndexTableFilenames(indexRaw) {
  const normalized = normalizeNewlines(indexRaw);
  const marker = "## docs 内ファイル一覧";
  const idx = normalized.indexOf(marker);
  assert.ok(idx !== -1, `${indexPath} must contain ${marker}`);

  const after = normalized.slice(idx + marker.length);
  const lines = after.split("\n");

  const names = new Set();
  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) {
      if (names.size > 0) {
        break;
      }
      continue;
    }
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) {
      continue;
    }
    const first = cells[0];
    if (first === "ファイル" || first.includes("---")) {
      continue;
    }
    if (first.endsWith(".md")) {
      names.add(first);
    }
  }
  assert.ok(names.size > 0, "docs index table must list at least one .md file");
  return names;
}

function loadRelatedContractPaths() {
  const raw = readProjectFile(contractsManifestPath);
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.related_contracts), "contracts manifest must have related_contracts array");
  assert.ok(data.related_contracts.length > 0, "related_contracts must be non-empty");
  return data.related_contracts;
}

test("platform premises fixture body is synced in all docs that declare premise truth_sources", () => {
  const fixtureRaw = readProjectFile(fixturePath);
  const expected = extractFixturePremisesBody(fixtureRaw);

  const docFiles = listDocMarkdownFiles();
  const synced = docFiles.filter((relativePath) => {
    const raw = readProjectFile(relativePath);
    const { front } = parseFrontmatter(raw);
    return truthSourcesIncludePremiseFixture(front);
  });

  assert.ok(
    synced.length > 0,
    `at least one docs/*.md must list ${premiseTruthSourceToken} under truth_sources`,
  );

  for (const relativePath of synced) {
    const docRaw = readProjectFile(relativePath);
    const { body } = parseFrontmatter(docRaw);
    const docNorm = trimBody(body);
    assert.ok(
      docNorm.includes(expected),
      `${relativePath} must contain the canonical platform-premises block from ${fixturePath}`,
    );
  }
});

test("platform premises contracts manifest paths exist", () => {
  const paths = loadRelatedContractPaths();

  for (const relativePath of paths) {
    const absolute = path.join(rootDir, relativePath);
    assert.equal(
      existsSync(absolute),
      true,
      `related_contracts entry must exist: ${relativePath}`,
    );
  }
});

test("docs index table lists every docs/*.md file exactly once", () => {
  const indexRaw = readProjectFile(indexPath);
  const tableNames = parseDocsIndexTableFilenames(indexRaw);

  const onDisk = new Set(
    listDocMarkdownFiles().map((p) => path.basename(p)),
  );

  assert.deepEqual(
    tableNames,
    onDisk,
    "platform-truth-index docs table must match docs/*.md (same set)",
  );
});
