import type { ActionFunctionArgs } from "react-router";

import { createProductExport } from "~/app/services/product-exports.server";

export const action = (args: ActionFunctionArgs) => createProductExport(args);

export default function ProductExportsRoute() {
  return null;
}
