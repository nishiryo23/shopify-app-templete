import { authenticateAdmin } from "~/platform/shopify.server";

export async function action() {
  return authenticateAdmin;
}
