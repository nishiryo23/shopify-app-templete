import { revokeBillingAccess } from "~/domain/webhooks/../billing/revoke.server";

export async function action() {
  return revokeBillingAccess();
}
