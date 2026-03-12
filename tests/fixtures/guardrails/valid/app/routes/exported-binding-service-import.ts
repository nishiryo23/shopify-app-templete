import { runProductPreview } from "~/app/services/products.server";

const loadProducts = async () => runProductPreview();

export { loadProducts as loader };
