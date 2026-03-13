import type { ActionFunctionArgs } from "react-router";

import { createProductPreview } from "~/app/services/product-previews.server";

export const action = (args: ActionFunctionArgs) => createProductPreview(args);

export default function ProductPreviewsRoute() {
  return null;
}
