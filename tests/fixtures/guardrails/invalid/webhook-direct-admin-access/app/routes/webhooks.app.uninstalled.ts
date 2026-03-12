import { adminClient } from "~/platform/shopify";

export async function action() {
  return adminClient;
}
