const LOOP_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "phase",
    "status",
    "summary",
    "iterations",
    "finalRemediation",
    "finalReview",
    "finalReadiness",
    "blockedReason",
    "nextAction",
  ],
  properties: {
    phase: { type: "string", const: "loop" },
    status: { type: "string", enum: ["complete", "blocked"] },
    summary: { type: "string" },
    iterations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "iteration",
          "rootCause",
          "fixStatus",
          "reviewStatus",
          "readinessStatus",
          "summary",
        ],
        properties: {
          iteration: { type: "integer", minimum: 1 },
          rootCause: { type: "string" },
          fixStatus: { type: "string", enum: ["completed", "blocked"] },
          reviewStatus: { type: "string", enum: ["clean", "findings", "blocked"] },
          readinessStatus: {
            type: "string",
            enum: ["clean", "gaps", "skipped", "blocked"],
          },
          summary: { type: "string" },
        },
      },
    },
    finalRemediation: {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "rootCause",
        "repoEvidence",
        "shopifyDocsEvidence",
        "validationEvidence",
        "residualRisk",
      ],
      properties: {
        status: { type: "string", enum: ["pass", "blocked"] },
        rootCause: { type: "string" },
        repoEvidence: { type: "array", items: { type: "string" } },
        shopifyDocsEvidence: { type: "array", items: { type: "string" } },
        validationEvidence: { type: "array", items: { type: "string" } },
        residualRisk: { type: "array", items: { type: "string" } },
      },
    },
    finalReview: {
      type: "object",
      additionalProperties: false,
      required: ["status", "findings"],
      properties: {
        status: { type: "string", enum: ["clean", "findings", "blocked"] },
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["severity", "title", "file", "recommendation"],
            properties: {
              severity: { type: "string", enum: ["high", "medium", "low"] },
              title: { type: "string" },
              file: { type: "string" },
              recommendation: { type: "string" },
            },
          },
        },
      },
    },
    finalReadiness: {
      type: "object",
      additionalProperties: false,
      required: ["status", "gaps"],
      properties: {
        status: { type: "string", enum: ["clean", "gaps", "skipped", "blocked"] },
        gaps: { type: "array", items: { type: "string" } },
      },
    },
    blockedReason: {
      anyOf: [
        { type: "null" },
        {
          type: "string",
          enum: [
            "iteration_limit",
            "fix_blocked",
            "review_blocked",
            "readiness_blocked",
            "permission_blocked",
            "evidence_missing",
            "unrelated_diff",
            "spec_conflict",
          ],
        },
      ],
    },
    nextAction: { type: "string" },
  },
};

const REVIEW_OUTPUT_SCHEMA = {
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
        required: ["severity", "title", "file", "recommendation"],
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" },
          file: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
    stopReason: { type: "string" },
  },
  required: ["phase", "status", "summary", "findings", "stopReason"],
};

function parseStructuredResponse(rawResponse, phase) {
  try {
    return JSON.parse(rawResponse);
  } catch (error) {
    throw new Error(
      `${phase} response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function buildReviewPrompt({ iteration, maxIterations }) {
  return [
    "Review the current uncommitted changes in this git repository.",
    "",
    `This is the external read-only review gate after autonomous loop iteration ${iteration} of ${maxIterations}.`,
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

function buildLoopPrompt({ maxIterations, lastIteration = 0, lastReview = null }) {
  return [
    "Use $shopify-review-loop.",
    "Run an autonomous remediation loop inside this single run.",
    "Do not stop after one remediation pass, and do not return intermediate continue/stop judgments as the final result.",
    `Keep iterating until Shopify app review is clean and readiness is clean, or until you are truly blocked, with a hard safety limit of ${maxIterations} total iterations.`,
    "Each iteration must stay on exactly one root cause.",
    "Within the loop, use this sequence:",
    "1. $shopify-review-fix to remediate one root cause and collect evidence.",
    "2. $shopify-app-review to review the current diff in read-only mode.",
    "3. Only after remediation review is clean, run $shopify-app-readiness-review.",
    "If remediation review returns findings, continue to the next iteration in the same run.",
    "If you hit a real blocker, return status blocked with a specific blockedReason.",
    "Use the shared evidence vocabulary from the Shopify review skills.",
    "Apply Shopify official docs as the source of truth for Shopify-specific validity checks.",
    "Enforce pnpm check or a documented alternative gate before returning complete.",
    'Return exactly one final JSON object with phase "loop" that matches the provided schema.',
    `The previous completed iteration count for this thread is ${lastIteration}.`,
    lastReview == null
      ? "There is no prior persisted review context."
      : `Prior persisted review context: ${JSON.stringify(lastReview)}`,
  ].join("\n");
}

function formatLoopSummary(loopResult) {
  const blockedReason =
    loopResult.blockedReason == null ? "none" : `, blockedReason: ${loopResult.blockedReason}`;
  return `Loop status: ${loopResult.status}${blockedReason} | iterations: ${loopResult.iterations.length}`;
}

export {
  buildReviewPrompt,
  buildLoopPrompt,
  formatLoopSummary,
  LOOP_OUTPUT_SCHEMA,
  parseStructuredResponse,
  REVIEW_OUTPUT_SCHEMA,
};
