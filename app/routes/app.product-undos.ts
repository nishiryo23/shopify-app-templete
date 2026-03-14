import type { ActionFunctionArgs } from "react-router";

import { createProductUndo } from "~/app/services/product-writes.server";

export const action = (args: ActionFunctionArgs) => createProductUndo(args);

export default function ProductUndosRoute() {
  return null;
}
