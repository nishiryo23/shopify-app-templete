import { adminClient } from "~/platform/shopify/admin.server";

export async function action() {
  return adminClient;
}
