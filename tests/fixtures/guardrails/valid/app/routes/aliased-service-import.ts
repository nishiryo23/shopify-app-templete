import { runProductPreview } from "~/app/services/products.server";

const service = runProductPreview;

export const loader = async () => service();
