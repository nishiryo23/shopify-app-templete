import test from "node:test";
import assert from "node:assert/strict";

import {
  ENTITLEMENT_STATES,
  isTerminalSubscriptionStatus,
  mapSubscriptionStatusToEntitlement,
} from "../../domain/billing/entitlement-state.mjs";

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
