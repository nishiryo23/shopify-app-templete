import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { createProductExport, loadProductExportDownload } from "~/app/services/product-exports.server";

export const loader = (args: LoaderFunctionArgs) => loadProductExportDownload(args);

export const action = (args: ActionFunctionArgs) => createProductExport(args);
