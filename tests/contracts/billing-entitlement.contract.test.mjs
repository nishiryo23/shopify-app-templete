import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTITLEMENT_STATES,
  isTerminalSubscriptionStatus,
  mapSubscriptionStatusToEntitlement,
} from "../../domain/billing/entitlement-state.mjs";
import { deriveCurrentInstallationEntitlement as deriveInstallationEntitlement } from "../../domain/billing/current-installation.mjs";

test("ACTIVE maps to ACTIVE_PAID", () => {
  assert.equal(
    mapSubscriptionStatusToEntitlement("ACTIVE"),
    ENTITLEMENT_STATES.ACTIVE_PAID,
  );
});

test("PENDING maps to PENDING_APPROVAL", () => {
  assert.equal(
    mapSubscriptionStatusToEntitlement("PENDING"),
    ENTITLEMENT_STATES.PENDING_APPROVAL,
  );
});

test("ACCEPTED maps to PENDING_APPROVAL", () => {
  assert.equal(
    mapSubscriptionStatusToEntitlement("ACCEPTED"),
    ENTITLEMENT_STATES.PENDING_APPROVAL,
  );
  assert.equal(isTerminalSubscriptionStatus("ACCEPTED"), false);
});

test("FROZEN maps to PAYMENT_HOLD", () => {
  assert.equal(
    mapSubscriptionStatusToEntitlement("FROZEN"),
    ENTITLEMENT_STATES.PAYMENT_HOLD,
  );
});

test("terminal statuses map to NOT_ENTITLED", () => {
  for (const status of ["CANCELLED", "DECLINED", "EXPIRED"]) {
    assert.equal(
      mapSubscriptionStatusToEntitlement(status),
      ENTITLEMENT_STATES.NOT_ENTITLED,
    );
    assert.equal(isTerminalSubscriptionStatus(status), true);
  }
});

test("unknown status is rejected", () => {
  assert.throws(
    () => mapSubscriptionStatusToEntitlement("UNKNOWN_STATUS"),
    /Unhandled app subscription status/,
  );
});

test("missing active subscriptions yields NOT_ENTITLED", () => {
  assert.deepEqual(
    deriveInstallationEntitlement({ activeSubscriptions: [], allSubscriptions: { nodes: [] } }),
    {
      checkedAt: null,
      currentPeriodEnd: null,
      hasActiveSubscription: false,
      sourceStatus: null,
      state: ENTITLEMENT_STATES.NOT_ENTITLED,
      subscriptionId: null,
      subscriptionName: null,
      test: false,
    },
  );
});

test("active subscription fields are normalized into pricing gate state", () => {
  assert.deepEqual(
    deriveInstallationEntitlement({
      activeSubscriptions: [
        {
          createdAt: "2026-03-01T00:00:00Z",
          currentPeriodEnd: "2026-04-01T00:00:00Z",
          id: "gid://shopify/AppSubscription/1",
          name: "Core Plan",
          status: "ACTIVE",
          test: true,
        },
      ],
      allSubscriptions: { nodes: [] },
    }),
    {
      checkedAt: null,
      currentPeriodEnd: "2026-04-01T00:00:00Z",
      hasActiveSubscription: true,
      sourceStatus: "ACTIVE",
      state: ENTITLEMENT_STATES.ACTIVE_PAID,
      subscriptionId: "gid://shopify/AppSubscription/1",
      subscriptionName: "Core Plan",
      test: true,
    },
  );
});

test("multiple active subscriptions are logged and first subscription wins", () => {
  const anomalyLog = [];
  const entitlement = deriveInstallationEntitlement(
    {
      activeSubscriptions: [
        { id: "gid://shopify/AppSubscription/1", status: "PENDING" },
        { id: "gid://shopify/AppSubscription/2", status: "ACTIVE" },
      ],
      allSubscriptions: { nodes: [] },
    },
    {
      logMultipleActiveSubscriptions(details) {
        anomalyLog.push(details);
      },
    },
  );

  assert.equal(entitlement.state, ENTITLEMENT_STATES.PENDING_APPROVAL);
  assert.deepEqual(anomalyLog, [
    {
      activeSubscriptionCount: 2,
      statuses: ["PENDING", "ACTIVE"],
      subscriptionIds: ["gid://shopify/AppSubscription/1", "gid://shopify/AppSubscription/2"],
    },
  ]);
});

test("pending subscription falls back to latest non-terminal allSubscriptions entry", () => {
  const fallbackLog = [];
  const entitlement = deriveInstallationEntitlement(
    {
      activeSubscriptions: [],
      allSubscriptions: {
        nodes: [
          {
            createdAt: "2026-03-12T12:00:00Z",
            id: "gid://shopify/AppSubscription/old-terminal",
            status: "DECLINED",
          },
          {
            createdAt: "2026-03-13T10:00:00Z",
            id: "gid://shopify/AppSubscription/pending",
            name: "Core Plan",
            status: "PENDING",
            test: false,
          },
        ],
      },
    },
    {
      logFallbackSubscriptionSelection(details) {
        fallbackLog.push(details);
      },
    },
  );

  assert.equal(entitlement.state, ENTITLEMENT_STATES.PENDING_APPROVAL);
  assert.equal(entitlement.hasActiveSubscription, false);
  assert.equal(entitlement.sourceStatus, "PENDING");
  assert.deepEqual(fallbackLog, [
    {
      fallbackStatus: "PENDING",
      isTerminal: false,
      subscriptionId: "gid://shopify/AppSubscription/pending",
    },
  ]);
});

test("fallback uses the latest subscription even when an older non-terminal entry exists", () => {
  const entitlement = deriveInstallationEntitlement({
    activeSubscriptions: [],
    allSubscriptions: {
      nodes: [
        {
          createdAt: "2026-03-13T00:00:00Z",
          id: "gid://shopify/AppSubscription/declined",
          status: "DECLINED",
        },
        {
          createdAt: "2026-03-10T00:00:00Z",
          id: "gid://shopify/AppSubscription/frozen",
          status: "FROZEN",
        },
      ],
    },
  });

  assert.equal(entitlement.state, ENTITLEMENT_STATES.NOT_ENTITLED);
  assert.equal(entitlement.subscriptionId, "gid://shopify/AppSubscription/declined");
  assert.equal(entitlement.sourceStatus, "DECLINED");
});
