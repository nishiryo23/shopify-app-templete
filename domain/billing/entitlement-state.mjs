const PAID_STATUSES = new Set(["ACTIVE"]);
const PENDING_STATUSES = new Set(["ACCEPTED", "PENDING"]);
const HOLD_STATUSES = new Set(["FROZEN"]);
const TERMINAL_STATUSES = new Set(["CANCELLED", "DECLINED", "EXPIRED"]);

export const ENTITLEMENT_STATES = Object.freeze({
  ACTIVE_PAID: "ACTIVE_PAID",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  PAYMENT_HOLD: "PAYMENT_HOLD",
  NOT_ENTITLED: "NOT_ENTITLED",
});

export function mapSubscriptionStatusToEntitlement(status) {
  if (PAID_STATUSES.has(status)) {
    return ENTITLEMENT_STATES.ACTIVE_PAID;
  }

  if (PENDING_STATUSES.has(status)) {
    return ENTITLEMENT_STATES.PENDING_APPROVAL;
  }

  if (HOLD_STATUSES.has(status)) {
    return ENTITLEMENT_STATES.PAYMENT_HOLD;
  }

  if (TERMINAL_STATUSES.has(status)) {
    return ENTITLEMENT_STATES.NOT_ENTITLED;
  }

  throw new Error(`Unhandled app subscription status: ${status}`);
}

export function isTerminalSubscriptionStatus(status) {
  return TERMINAL_STATUSES.has(status);
}
