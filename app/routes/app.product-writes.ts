import type { ActionFunctionArgs } from "react-router";

import { createProductWrite } from "~/app/services/product-writes.server";

export const action = (args: ActionFunctionArgs) => createProductWrite(args);

export default function ProductWritesRoute() {
  return null;
}
