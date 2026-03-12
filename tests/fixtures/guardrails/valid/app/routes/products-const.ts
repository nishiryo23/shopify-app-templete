import { runProductPreview } from "~/app/services/products.server";

export const loader = async () => runProductPreview();
