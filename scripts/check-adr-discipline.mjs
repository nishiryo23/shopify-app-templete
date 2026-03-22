import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const adrRequiredPatterns = [
  /^app\/services\/auth(?:[-./]|$)/,
  /^app\/services\/billing(?:[-./]|$)/,
  /^domain\/webhooks\//,
  /^platform\/shopify\//,
  /^app\/routes\/webhooks(?:[./]|\/)/,
  /^app\/routes\/app\.pricing\.[cm]?[jt]sx?$/,
  /^app\/routes\/app\.welcome\.[cm]?[jt]sx?$/,
  /^shopify\.app\.toml$/,
  /^shopify\.web\.toml$/,
  /^prisma\/schema\.prisma$/,
];

function normalizePath(value) {
  return value.replaceAll(path.sep, "/");
}

function pathRequiresAdr(relativePath) {
  return adrRequiredPatterns.some((pattern) => pattern.test(relativePath));
}

async function readChangedFiles() {
  const staged = await execFile("git", ["diff", "--cached", "--name-only"], {
    cwd: projectRoot,
  });
  const unstaged = await execFile("git", ["diff", "--name-only"], {
    cwd: projectRoot,
  });
  const untracked = await execFile("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: projectRoot,
  });

  return [
    ...new Set(
      [staged.stdout, unstaged.stdout, untracked.stdout]
        .flatMap((stdout) => stdout.split("\n"))
        .map((line) => line.trim())
        .filter(Boolean)
        .map(normalizePath),
    ),
  ];
}

async function readChangedFileSets() {
  const staged = await execFile("git", ["diff", "--cached", "--name-only"], {
    cwd: projectRoot,
  });
  const unstaged = await execFile("git", ["diff", "--name-only"], {
    cwd: projectRoot,
  });
  const untracked = await execFile("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: projectRoot,
  });

  return {
    staged: staged.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(normalizePath),
    unstaged: unstaged.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(normalizePath),
    untracked: untracked.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(normalizePath),
  };
}

function parseAdrMetadata(content) {
  const requiredMatch = content.match(/- ADR required:\s*(yes|no)\s*$/m);
  const adrMatch = content.match(/- ADR:\s*((?:[0-9]{4}(?:,\s*[0-9]{4})*)|none)\s*$/m);
  const whyMatch = content.match(/- Why:\s*(.+)$/m);

  return {
    adr: adrMatch?.[1] ?? null,
    adrRequired: requiredMatch?.[1] ?? null,
    why: whyMatch?.[1]?.trim() ?? null,
  };
}

function validatePlanContent(relativePath, content) {
  if (!content.includes("## ADR impact")) {
    return [];
  }

  const violations = [];
  const { adr, adrRequired, why } = parseAdrMetadata(content);

  if (!adrRequired) {
    violations.push({
      code: "adr-plan-metadata-missing",
      message: "plan ADR impact must declare `- ADR required: yes|no`",
      file: relativePath,
    });
  }

  if (!adr) {
    violations.push({
      code: "adr-plan-metadata-missing",
      message: "plan ADR impact must declare `- ADR: 0001` or `- ADR: none`",
      file: relativePath,
    });
  }

  if (!why) {
    violations.push({
      code: "adr-plan-metadata-missing",
      message: "plan ADR impact must declare `- Why: ...`",
      file: relativePath,
    });
  }

  if (adrRequired === "yes" && adr === "none") {
    violations.push({
      code: "adr-plan-metadata-invalid",
      message: "plan marks ADR required but does not reference an ADR number",
      file: relativePath,
    });
  }

  return violations;
}

async function validateChangedPlanFiles(changedFiles) {
  const planFiles = changedFiles.filter(
    (relativePath) =>
      /^plans\/.+\.md$/.test(relativePath) || relativePath === ".agent/PLANS.md",
  );
  const violations = [];

  for (const relativePath of planFiles) {
    const absolutePath = path.join(projectRoot, relativePath);
    let content;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    if (relativePath === ".agent/PLANS.md") {
      if (!/- ADR required: yes\|no/.test(content)) {
        violations.push({
          code: "adr-plan-metadata-missing",
          message: "plan template must declare `- ADR required: yes|no`",
          file: relativePath,
        });
      }

      if (!/- ADR: 0001,0004\|none/.test(content)) {
        violations.push({
          code: "adr-plan-metadata-missing",
          message: "plan template must declare `- ADR: 0001,0004|none`",
          file: relativePath,
        });
      }

      if (!/- Why: 1〜2 文で理由/.test(content)) {
        violations.push({
          code: "adr-plan-metadata-missing",
          message: "plan template must declare `- Why: ...`",
          file: relativePath,
        });
      }

      continue;
    }

    violations.push(...validatePlanContent(relativePath, content));
  }

  return violations;
}

function validateAdrChangeRequirement(changedFiles) {
  const requiresAdr = changedFiles.some(pathRequiresAdr);

  if (!requiresAdr) {
    return [];
  }

  const hasAdrChange = changedFiles.some((relativePath) => /^adr\/\d{4}-.+\.md$/.test(relativePath));

  if (hasAdrChange) {
    return [];
  }

  return [
    {
      code: "adr-required-change",
      file: "(diff)",
      message:
        "changes touching auth/billing/webhooks/config/schema truths must update an ADR in adr/*.md",
    },
  ];
}

function validateAdrChangeRequirementBySet(changedFileSets) {
  const violations = [];

  for (const [setName, changedFiles] of Object.entries(changedFileSets)) {
    const requiresAdr = changedFiles.some(pathRequiresAdr);

    if (!requiresAdr) {
      continue;
    }

    const hasAdrChange = changedFiles.some((relativePath) => /^adr\/\d{4}-.+\.md$/.test(relativePath));

    if (!hasAdrChange) {
      violations.push({
        code: "adr-required-change",
        file: `(${setName})`,
        message:
          `changes in ${setName} touching auth/billing/webhooks/config/schema truths must update an ADR in the same change set`,
      });
    }
  }

  return violations;
}

function formatViolations(violations) {
  return violations
    .map((violation) => `${violation.code}: ${violation.file} - ${violation.message}`)
    .join("\n");
}

async function runAdrDisciplineCheck() {
  const changedFileSets = await readChangedFileSets();
  const changedFiles = await readChangedFiles();
  const violations = [
    ...validateAdrChangeRequirementBySet(changedFileSets),
    ...(await validateChangedPlanFiles(changedFiles)),
  ];

  if (violations.length > 0) {
    console.error("ADR discipline violations detected:");
    console.error(formatViolations(violations));
    process.exitCode = 1;
    return;
  }

  console.log("ADR discipline passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runAdrDisciplineCheck();
}

export {
  parseAdrMetadata,
  pathRequiresAdr,
  readChangedFiles,
  readChangedFileSets,
  validateAdrChangeRequirement,
  validateAdrChangeRequirementBySet,
  validateChangedPlanFiles,
  validatePlanContent,
};
