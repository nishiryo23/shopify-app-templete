export const FIX_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    phase: { type: "string", const: "fix" },
    status: { type: "string", enum: ["completed", "blocked"] },
    rootCause: { type: "string" },
    diffScope: { type: "string" },
    summary: { type: "string" },
    touchedFiles: {
      type: "array",
      items: { type: "string" },
    },
    testsRun: {
      type: "array",
      items: { type: "string" },
    },
    shopifyDocs: {
      type: "array",
      items: { type: "string" },
    },
    stopReason: { type: "string" },
  },
  required: [
    "phase",
    "status",
    "rootCause",
    "diffScope",
    "summary",
    "touchedFiles",
    "testsRun",
    "shopifyDocs",
    "stopReason",
  ],
};

export const REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    phase: { type: "string", const: "review" },
    status: { type: "string", enum: ["clean", "findings", "blocked"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          file: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["severity", "title", "file", "recommendation"],
      },
    },
    stopReason: { type: "string" },
  },
  required: ["phase", "status", "summary", "findings", "stopReason"],
};

export function parseStructuredResponse(finalResponse, label) {
  try {
    return JSON.parse(finalResponse);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} response was not valid JSON: ${reason}`);
  }
}

export function buildFixPrompt({ iteration, maxIterations, priorReview }) {
  const reviewContext = formatPriorReview(priorReview);

  return [
    "Use $shopify-review-fix for exactly one remediation pass.",
    "",
    `This is iteration ${iteration} of ${maxIterations} in an externally controlled loop.`,
    "Constraints:",
    "- Apply the next root-cause-level remediation needed for Shopify App Store review readiness.",
    "- Keep the fix scope broad enough to address that root cause across related code, config, docs, tests, listing metadata, and submission artifacts when needed.",
    "- Do not mix unrelated changes into this pass.",
    "- Use Shopify.dev as the source of truth for Shopify-specific judgments.",
    "- Run project-appropriate validation after making changes.",
    "- Stop after this single remediation pass and return the structured summary only.",
    "",
    reviewContext,
    "",
    "If the previous external review had findings, address those findings first.",
    "If the previous external review was clean or absent, inspect the current repository state and choose the highest-priority unresolved root cause.",
    'Return JSON matching the provided schema with phase="fix".',
  ].join("\n");
}

export function buildReviewPrompt({ iteration, maxIterations }) {
  return [
    "Review the current uncommitted changes in this git repository.",
    "",
    `This is the external review gate after remediation iteration ${iteration} of ${maxIterations}.`,
    "Review only the current uncommitted diff.",
    "Do not modify any files.",
    "Focus on:",
    "- bugs and behavioral regressions",
    "- Shopify-specific review risks",
    "- missing or insufficient tests",
    "- code/config/docs inconsistencies",
    "",
    "Rules:",
    '- If there are no actionable findings, return status "clean".',
    '- If there are actionable findings, return status "findings" with severity-ordered items.',
    '- If unrelated diff mixing prevents a trustworthy review, return status "blocked".',
    "",
    'Return JSON matching the provided schema with phase="review".',
  ].join("\n");
}

export function shouldContinueLoop(reviewResult) {
  return reviewResult.status === "findings";
}

export function formatIterationSummary({ iteration, fixResult, reviewResult }) {
  const findingsSummary =
    reviewResult.findings.length === 0
      ? "0 findings"
      : `${reviewResult.findings.length} findings`;

  return [
    `Iteration ${iteration}`,
    `fix: ${fixResult.status} (${fixResult.rootCause})`,
    `review: ${reviewResult.status} (${findingsSummary})`,
  ].join(" | ");
}

function formatPriorReview(priorReview) {
  if (!priorReview) {
    return "Previous external review: none.";
  }

  if (priorReview.status === "clean") {
    return `Previous external review: clean. Summary: ${priorReview.summary}`;
  }

  if (priorReview.status === "blocked") {
    return [
      "Previous external review was blocked.",
      `Blocker: ${priorReview.stopReason || priorReview.summary}`,
    ].join("\n");
  }

  const findings = priorReview.findings
    .map((finding, index) => {
      return `${index + 1}. [${finding.severity}] ${finding.title} | ${finding.file} | ${finding.recommendation}`;
    })
    .join("\n");

  return [
    "Previous external review findings:",
    findings,
    `Summary: ${priorReview.summary}`,
  ].join("\n");
}
