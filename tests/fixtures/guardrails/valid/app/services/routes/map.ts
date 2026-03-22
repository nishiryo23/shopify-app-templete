import { mapSubscriptionStatusToEntitlement } from "~/domain/billing/entitlement-state.mjs";

export function buildRouteMap() {
  return mapSubscriptionStatusToEntitlement;
}
