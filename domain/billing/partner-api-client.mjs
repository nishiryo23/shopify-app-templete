export const PARTNER_API_VERSION = "2026-07";

export const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
    query ActiveSubscription($appId: ID!, $shopId: ID!) {
      activeSubscription(appId: $appId, shopId: $shopId) {
        legacySubscriptionId
        trialEndsAt
        currentBillingCycle {
          startTime
          endTime
        }
        pendingUpdate {
          billingPeriod
          items {
            handle
          }
          legacySubscriptionId
        }
        items {
          handle
          price {
            __typename
            active
            currency
            ... on FlatRatePrice {
              amount
            }
            ... on TieredPrice {
              tiersMode
              tiers {
                upTo
                amountPerUnit
                amount
              }
            }
          }
        }
      }
    }
`;

export class PartnerApiConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PartnerApiConfigurationError";
  }
}

export class PartnerApiRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "PartnerApiRateLimitError";
  }
}

function requireNonEmptyString(value, envName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PartnerApiConfigurationError(`${envName} is required for Partner API billing refresh.`);
  }

  return value.trim();
}

function requireEndpointPathSegment(value, envName) {
  const resolvedValue = requireNonEmptyString(value, envName);

  if (resolvedValue.includes("/")) {
    throw new PartnerApiConfigurationError(`${envName} must not contain path separators.`);
  }

  return resolvedValue;
}

export function buildPartnerApiGraphqlEndpoint(organizationId) {
  const resolvedOrganizationId = requireEndpointPathSegment(organizationId, "PARTNER_API_ORG_ID");

  return `https://partners.shopify.com/${encodeURIComponent(resolvedOrganizationId)}/api/${PARTNER_API_VERSION}/graphql.json`;
}

async function parsePartnerApiResponse(response) {
  if (response.status === 429) {
    throw new PartnerApiRateLimitError("Partner API activeSubscription query was rate limited with HTTP 429.");
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Partner API activeSubscription query failed with HTTP ${response.status}.`);
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors[0]?.message ?? "Unknown GraphQL error";
    throw new Error(`Partner API activeSubscription query failed: ${message}`);
  }

  if (!payload.data || !("activeSubscription" in payload.data)) {
    throw new Error("Partner API activeSubscription query returned no activeSubscription field.");
  }

  return payload.data.activeSubscription ?? null;
}

export function createPartnerApiClient({
  accessToken = process.env.PARTNER_API_ACCESS_TOKEN,
  fetchImpl = globalThis.fetch,
  organizationId = process.env.PARTNER_API_ORG_ID,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new PartnerApiConfigurationError("fetch implementation is required for Partner API billing refresh.");
  }

  return {
    async queryActiveSubscription({ appId, shopId }) {
      const token = requireNonEmptyString(accessToken, "PARTNER_API_ACCESS_TOKEN");
      const endpoint = buildPartnerApiGraphqlEndpoint(organizationId);
      const resolvedAppId = requireNonEmptyString(appId, "SHOPIFY_APP_GID");
      const resolvedShopId = requireNonEmptyString(shopId, "shopId");
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({
          query: ACTIVE_SUBSCRIPTION_QUERY,
          variables: {
            appId: resolvedAppId,
            shopId: resolvedShopId,
          },
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        method: "POST",
      });

      return parsePartnerApiResponse(response);
    },
  };
}
