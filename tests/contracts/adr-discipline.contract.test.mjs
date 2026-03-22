import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  parseAdrMetadata,
  pathRequiresAdr,
  validateAdrChangeRequirement,
  validateAdrChangeRequirementBySet,
  validateChangedPlanFiles,
  validatePlanContent,
} from "../../scripts/check-adr-discipline.mjs";

const rootDir = path.resolve(import.meta.dirname, "../..");

function readProjectFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

test("ADR-required paths cover auth billing webhook config and schema truths", () => {
  assert.equal(pathRequiresAdr("app/services/auth-bootstrap.server.ts"), true);
  assert.equal(pathRequiresAdr("app/services/billing.server.ts"), true);
  assert.equal(pathRequiresAdr("domain/webhooks/enqueue.server.ts"), true);
  assert.equal(pathRequiresAdr("platform/shopify/current-app-installation.server.ts"), true);
  assert.equal(pathRequiresAdr("shopify.app.toml"), true);
  assert.equal(pathRequiresAdr("prisma/schema.prisma"), true);
  assert.equal(pathRequiresAdr("app/routes/app._index.tsx"), false);
});

test("ADR-required change fails when no ADR file is changed", () => {
  const violations = validateAdrChangeRequirement([
    "app/services/billing.server.ts",
    "tests/contracts/billing-entitlement.contract.test.mjs",
  ]);

  assert.deepEqual(violations, [
    {
      code: "adr-required-change",
      file: "(diff)",
      message:
        "changes touching auth/billing/webhooks/config/schema truths must update an ADR in adr/*.md",
    },
  ]);
});

test("ADR-required change passes when an ADR markdown file is changed", () => {
  assert.deepEqual(
    validateAdrChangeRequirement([
      "app/services/billing.server.ts",
      "adr/0003-managed-pricing-as-billing-source-of-truth.md",
    ]),
    [],
  );
});

test("ADR-required change is triggered by untracked platform shopify files too", () => {
  const violations = validateAdrChangeRequirement([
    "platform/shopify/new-billing-query.server.ts",
  ]);

  assert.deepEqual(violations, [
    {
      code: "adr-required-change",
      file: "(diff)",
      message:
        "changes touching auth/billing/webhooks/config/schema truths must update an ADR in adr/*.md",
    },
  ]);
});

test("ADR-required change checks the union of staged and unstaged relevant files", () => {
  const violations = validateAdrChangeRequirement([
    "docs/notes.md",
    "app/services/billing.server.ts",
  ]);

  assert.deepEqual(violations, [
    {
      code: "adr-required-change",
      file: "(diff)",
      message:
        "changes touching auth/billing/webhooks/config/schema truths must update an ADR in adr/*.md",
    },
  ]);
});

test("ADR-required change by set fails when only an unrelated ADR dirty change exists", () => {
  const violations = validateAdrChangeRequirementBySet({
    staged: ["docs/notes.md"],
    unstaged: [
      "platform/shopify/current-app-installation.server.ts",
      "adr/0001-repo-truth-and-codex-harness.md",
    ],
    untracked: [],
  });

  assert.deepEqual(violations, []);
});

test("ADR-required change by set does not let unrelated ADR changes satisfy another set", () => {
  const violations = validateAdrChangeRequirementBySet({
    staged: ["platform/shopify/current-app-installation.server.ts"],
    unstaged: ["adr/0001-repo-truth-and-codex-harness.md"],
    untracked: [],
  });

  assert.deepEqual(violations, [
    {
      code: "adr-required-change",
      file: "(staged)",
      message:
        "changes in staged touching auth/billing/webhooks/config/schema truths must update an ADR in the same change set",
    },
  ]);
});

test("ADR-required change by set passes when the same set contains the ADR update", () => {
  const violations = validateAdrChangeRequirementBySet({
    staged: [
      "platform/shopify/current-app-installation.server.ts",
      "adr/0003-managed-pricing-as-billing-source-of-truth.md",
    ],
    unstaged: [],
    untracked: [],
  });

  assert.deepEqual(violations, []);
});

test("plan ADR metadata parser reads required flag and ADR number", () => {
  assert.deepEqual(
    parseAdrMetadata(`## ADR impact\n- ADR required: yes\n- ADR: 0001, 0004\n- Why: harness truth changes\n`),
    { adr: "0001, 0004", adrRequired: "yes", why: "harness truth changes" },
  );
  assert.deepEqual(
    parseAdrMetadata(`## ADR impact\n- ADR required: no\n- ADR: none\n- Why: no design truth changes\n`),
    { adr: "none", adrRequired: "no", why: "no design truth changes" },
  );
});

test("validateChangedPlanFiles skips deleted or missing plan files", async () => {
  assert.deepEqual(
    await validateChangedPlanFiles(["plans/__nonexistent_plan_for_adr_discipline_skip__.md"]),
    [],
  );
});

test("plan ADR impact requires structured metadata", () => {
  const violations = validatePlanContent(
    "plans/example.md",
    `## ADR impact\n- 既存 ADR 更新\n`,
  );

  assert.equal(violations.length, 3);
  assert.equal(violations[0].code, "adr-plan-metadata-missing");
  assert.equal(violations[1].code, "adr-plan-metadata-missing");
  assert.equal(violations[2].code, "adr-plan-metadata-missing");
});

test("plan template and all committed plans declare ADR metadata", () => {
  const template = readProjectFile(".agent/PLANS.md");
  assert.match(template, /- ADR required: yes\|no/);
  assert.match(template, /- ADR: 0001,0004\|none/);
  assert.match(template, /- Why: 1〜2 文で理由/);

  const planDir = path.join(rootDir, "plans");
  const adrDir = path.join(rootDir, "adr");
  const adrFiles = new Set(readdirSync(adrDir));

  for (const filename of readdirSync(planDir)) {
    if (!filename.endsWith(".md")) {
      continue;
    }

    const relativePath = `plans/${filename}`;
    const content = readProjectFile(relativePath);
    const violations = validatePlanContent(relativePath, content);
    assert.deepEqual(violations, [], `${relativePath} should declare ADR metadata`);

    const { adr, adrRequired } = parseAdrMetadata(content);
    if (adrRequired === "yes" && adr && adr !== "none") {
      for (const adrNumber of adr.split(",").map((value) => value.trim())) {
        assert.equal(
          [...adrFiles].some((adrFile) => adrFile.startsWith(`${adrNumber}-`)),
          true,
          `${relativePath} should reference an existing ADR file for ${adrNumber}`,
        );
      }
    }
  }
});
