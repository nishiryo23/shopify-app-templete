import { revokeBillingAccess } from "~/domain/billing/revoke.server";

export async function action() {
  return revokeBillingAccess();
}
