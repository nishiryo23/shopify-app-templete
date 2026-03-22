import { mapSubscriptionStatusToEntitlement } from "~/domain/billing/entitlement-state.mjs";

export async function action() {
  return mapSubscriptionStatusToEntitlement("ACTIVE");
}
