import { hashShopDomain } from "../telemetry/emf.mjs";
export {
  buildFunnelEventRetentionCutoff,
  FUNNEL_EVENT_RETENTION_DAYS,
} from "../retention/policy.mjs";

export const FUNNEL_EVENTS = Object.freeze([
  "installed",
  "onboarding_step_completed",
  "activated",
  "plan_selection_viewed",
  "subscription_active",
  "uninstalled",
]);

export const FUNNEL_METADATA_ALLOWLIST = Object.freeze({
  installed: Object.freeze(["source"]),
  onboarding_step_completed: Object.freeze([
    "stepId",
    "completedStepCount",
    "totalStepCount",
  ]),
  activated: Object.freeze([
    "activationSource",
    "completedStepCount",
    "totalStepCount",
  ]),
  plan_selection_viewed: Object.freeze([
    "entitlementState",
    "hasPlanSelectionUrl",
  ]),
  subscription_active: Object.freeze([
    "entitlementState",
    "subscriptionStatus",
    "subscriptionNamePresent",
  ]),
  uninstalled: Object.freeze([
    "installedAt",
    "tenureDays",
    "lastEntitlementState",
    "onboardingCompletedSteps",
    "onboardingTotalSteps",
    "onboardingCompletionRate",
  ]),
});

const FUNNEL_EVENT_SET = new Set(FUNNEL_EVENTS);
const ALLOWED_INSTALLED_SOURCES = new Set(["auth_bootstrap"]);
const ALLOWED_ACTIVATION_SOURCES = new Set(["merchant_action", "domain_action"]);
const PII_METADATA_KEYS = new Set([
  "address",
  "customeraddress",
  "customeremail",
  "customername",
  "customerphone",
  "email",
  "firstname",
  "fullname",
  "lastname",
  "name",
  "phone",
]);

export class FunnelMetadataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FunnelMetadataValidationError";
  }
}

function normalizeMetadataKey(key) {
  return key.replaceAll(/[-_\s.]/g, "").toLowerCase();
}

export function containsPiiMetadataKey(key) {
  return PII_METADATA_KEYS.has(normalizeMetadataKey(key));
}

export function isFunnelEvent(value) {
  return FUNNEL_EVENT_SET.has(value);
}

function assertPlainMetadata(metadata) {
  if (
    metadata == null
    || typeof metadata !== "object"
    || Array.isArray(metadata)
  ) {
    throw new FunnelMetadataValidationError("metadata must be a plain object");
  }
}

function assertAllowedKey({ allowedKeys, key }) {
  if (containsPiiMetadataKey(key)) {
    throw new FunnelMetadataValidationError(`metadata key is prohibited: ${key}`);
  }

  if (!allowedKeys.includes(key)) {
    throw new FunnelMetadataValidationError(`metadata key is not allowed for funnel event: ${key}`);
  }
}

function assertString(value, key) {
  if (typeof value !== "string" || value.length === 0) {
    throw new FunnelMetadataValidationError(`${key} must be a non-empty string`);
  }
}

function assertBoolean(value, key) {
  if (typeof value !== "boolean") {
    throw new FunnelMetadataValidationError(`${key} must be a boolean`);
  }
}

function assertNonNegativeInteger(value, key) {
  if (!Number.isInteger(value) || value < 0) {
    throw new FunnelMetadataValidationError(`${key} must be a non-negative integer`);
  }
}

function assertRate(value, key) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    throw new FunnelMetadataValidationError(`${key} must be a number between 0 and 1`);
  }
}

function assertIsoDateTime(value, key) {
  assertString(value, key);

  if (Number.isNaN(Date.parse(value))) {
    throw new FunnelMetadataValidationError(`${key} must be an ISO datetime string`);
  }
}

function assertInstalledSource(value, key) {
  assertString(value, key);

  if (!ALLOWED_INSTALLED_SOURCES.has(value)) {
    throw new FunnelMetadataValidationError(`${key} is not an allowed installed source`);
  }
}

function assertActivationSource(value, key) {
  assertString(value, key);

  if (!ALLOWED_ACTIVATION_SOURCES.has(value)) {
    throw new FunnelMetadataValidationError(`${key} is not an allowed activation source`);
  }
}

const METADATA_VALIDATORS = Object.freeze({
  installed: Object.freeze({
    source: assertInstalledSource,
  }),
  onboarding_step_completed: Object.freeze({
    completedStepCount: assertNonNegativeInteger,
    stepId: assertString,
    totalStepCount: assertNonNegativeInteger,
  }),
  activated: Object.freeze({
    activationSource: assertActivationSource,
    completedStepCount: assertNonNegativeInteger,
    totalStepCount: assertNonNegativeInteger,
  }),
  plan_selection_viewed: Object.freeze({
    entitlementState: assertString,
    hasPlanSelectionUrl: assertBoolean,
  }),
  subscription_active: Object.freeze({
    entitlementState: assertString,
    subscriptionNamePresent: assertBoolean,
    subscriptionStatus: assertString,
  }),
  uninstalled: Object.freeze({
    installedAt: assertIsoDateTime,
    lastEntitlementState: assertString,
    onboardingCompletedSteps: assertNonNegativeInteger,
    onboardingCompletionRate: assertRate,
    onboardingTotalSteps: assertNonNegativeInteger,
    tenureDays: assertNonNegativeInteger,
  }),
});

export function sanitizeFunnelMetadata({ event, metadata = {} }) {
  if (!isFunnelEvent(event)) {
    throw new FunnelMetadataValidationError(`unknown funnel event: ${event}`);
  }

  assertPlainMetadata(metadata);

  const allowedKeys = FUNNEL_METADATA_ALLOWLIST[event] ?? [];
  const validators = METADATA_VALIDATORS[event] ?? {};
  const sanitized = {};

  for (const [key, value] of Object.entries(metadata)) {
    assertAllowedKey({ allowedKeys, key });

    const validate = validators[key];
    if (typeof validate !== "function") {
      throw new FunnelMetadataValidationError(`metadata key has no validator: ${key}`);
    }
    validate(value, key);

    sanitized[key] = value;
  }

  return sanitized;
}

export function resolveFunnelShopHash({ env = process.env, shopDomain }) {
  return hashShopDomain(shopDomain, env);
}

export function buildFunnelEventShopWhere({ env = process.env, shopDomain }) {
  const shopHash = resolveFunnelShopHash({ env, shopDomain });

  if (!shopHash) {
    return null;
  }

  return { shopHash };
}
