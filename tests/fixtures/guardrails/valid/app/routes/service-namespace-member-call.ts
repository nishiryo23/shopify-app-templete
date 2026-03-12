import * as productsService from "~/app/services/products.server";

export const loader = async () => productsService.runProductPreview();
